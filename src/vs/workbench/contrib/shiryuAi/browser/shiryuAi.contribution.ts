/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IChatAgentData, IChatAgentImplementation, IChatAgentRequest, IChatAgentResult, IChatAgentService, IChatAgentHistoryEntry } from '../../chat/common/participants/chatAgents.js';
import { IChatProgress, IChatMarkdownContent, IChatFollowup } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IShiryuAiService } from '../common/shiryuAiService.js';
import { IShiryuToolService, IShiryuToolCall } from '../common/shiryuAiTools.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { ShiryuAiModelManagerView } from './shiryuAiModelManagerView.js';
import { ShiryuAiChatView } from './shiryuAiChatView.js';

//#region Agent Data

function createAgentData(name: string, description: string, modelPath: string): IChatAgentData {
	const baseId = modelPath.replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/-+/g, '-').toLowerCase();
	const id = `shiryu-ai-${baseId}`.substring(0, 64);

	return {
		id,
		name,
		fullName: `Shiryu AI (${name})`,
		description,
		isDefault: modelPath === '', // Only the default is the empty-path generic agent
		isCore: true,
		extensionId: new ExtensionIdentifier('shiryu-studios.shiryu-ai-studio'),
		extensionVersion: '1.0.0',
		extensionPublisherId: 'shiryu-studios',
		publisherDisplayName: 'Shiryu Studios LLC',
		extensionDisplayName: 'Shiryu AI Studio',
		locations: [ChatAgentLocation.Chat, ChatAgentLocation.Terminal, ChatAgentLocation.Notebook],
		modes: [ChatModeKind.Ask, ChatModeKind.Edit, ChatModeKind.Agent],
		slashCommands: [
			{
				name: 'load-model',
				description: 'Load a GGUF model file for local inference',
				followupPlaceholder: 'Enter path to .gguf model file',
			},
			{
				name: 'unload-model',
				description: 'Unload the current model and free memory',
			},
			{
				name: 'model-info',
				description: 'Show information about the currently loaded model',
			},
		],
		disambiguation: [
			{
				category: 'local-ai',
				description: `${name} — local AI using llama.cpp`,
				examples: ['write a function', 'fix this bug', 'explain this code', 'refactor this'],
			},
		],
		metadata: {
			themeIcon: { id: 'robot' },
			helpTextPrefix: `${name} runs locally on your machine using llama.cpp.`,
			followupPlaceholder: `Ask ${name} anything...`,
		},
		capabilities: {
			supportsFileAttachments: false,
			supportsToolAttachments: false,
		},
	};
}

//#endregion

//#region Agent Implementation

class ShiryuAiAgent implements IChatAgentImplementation {

	/** Optional bound model path — if set, auto-loads this model */
	private _boundModelPath: string | undefined;
	private _modelName: string;

	constructor(
		private readonly shiryuAiService: IShiryuAiService,
		private readonly toolService: IShiryuToolService,
		private readonly logService: ILogService,
		modelPath?: string,
	) {
		this._boundModelPath = modelPath;
		this._modelName = modelPath
			? (modelPath.split('\\').pop() || modelPath.split('/').pop() || modelPath).replace('.gguf', '')
			: 'Shiryu AI';
	}

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		history: IChatAgentHistoryEntry[],
		token: CancellationToken
	): Promise<IChatAgentResult> {

		// Handle slash commands
		if (request.command) {
			return this.handleCommand(request.command, request.message, progress, token);
		}

		// If this agent is bound to a specific model, auto-load it
		if (this._boundModelPath) {
			const currentInfo = this.shiryuAiService.getModelInfo();
			const isAlreadyLoaded = currentInfo && currentInfo.modelPath === this._boundModelPath;

			if (!isAlreadyLoaded) {
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(`Loading \`${this._modelName}\`...`),
				}]);
				try {
					await this.shiryuAiService.loadModel({
						modelPath: this._boundModelPath,
						gpuLayers: -1,
						temperature: 0.7,
						maxTokens: 2048,
					});
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`**Failed to load model:** ${errorMsg}`),
					}]);
					return { errorDetails: { message: errorMsg } };
				}
			}
		}

		// Regular prompt — send to local model
		if (!this.shiryuAiService.isAvailable) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(
					'**No model loaded.** Use `@Shiryu AI /load-model <path>` to load a GGUF model file first.\n\n' +
					'Example: `@Shiryu AI /load-model C:/models/codellama-7b.Q4_K_M.gguf`'
				),
			}]);
			return {};
		}

		if (this.shiryuAiService.isBusy) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('Shiryu AI is currently generating a response. Please wait...'),
			}]);
			return {
				errorDetails: { message: 'Model is busy' },
			};
		}

		// Build the prompt with conversation history and tool definitions
		const fullPrompt = this.buildPrompt(request.message, history, true);

		// Stream tokens to the chat
		try {
			const response = await this.shiryuAiService.sendPrompt(
				fullPrompt,
				(chunk) => {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(chunk),
					}]);
				},
				token
			);

			this.logService.info(
				`[ShiryuAI] Response generated: ${response.tokenCount} tokens in ${response.durationMs}ms ` +
				`(${response.tokensPerSecond.toFixed(1)} tokens/sec)`
			);

			// Execute tool calls if any
			if (response.toolCalls && response.toolCalls.length > 0) {
				return await this._handleToolCalls(response.toolCalls, progress, token);
			}

			return {
				metadata: {
					tokenCount: response.tokenCount,
					durationMs: response.durationMs,
					tokensPerSecond: response.tokensPerSecond,
				},
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this.logService.error(`[ShiryuAI] Generation error: ${errorMsg}`);
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(`**Error:** ${errorMsg}`),
			}]);
			return {
				errorDetails: { message: errorMsg },
			};
		}
	}

	provideFollowups(
		_request: IChatAgentRequest,
		_result: IChatAgentResult,
		_history: IChatAgentHistoryEntry[],
		_token: CancellationToken
	): Promise<IChatFollowup[]> {
		return Promise.resolve([]);
	}

	private async handleCommand(
		command: string,
		message: string,
		progress: (parts: IChatProgress[]) => void,
		_token: CancellationToken
	): Promise<IChatAgentResult> {
		switch (command) {
			case 'load-model': {
				const modelPath = message.replace(/^\/?load-model\s*/i, '').trim();
				if (!modelPath) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString('**Usage:** `/load-model <path-to-model.gguf>`'),
					}]);
					return {};
				}

				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(`Loading model: \`${modelPath}\`...`),
				}]);

				try {
					await this.shiryuAiService.loadModel({
						modelPath,
						contextSize: 4096,
						gpuLayers: -1,
						temperature: 0.7,
						maxTokens: 2048,
					});

					const info = this.shiryuAiService.getModelInfo();
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(
							`**Model loaded successfully!**\n\n` +
							`- Path: \`${info?.modelPath}\`\n` +
							`- Context: ${info?.contextSize} tokens\n` +
							`- Status: Ready for inference`
						),
					}]);
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(`**Failed to load model:** ${errorMsg}`),
					}]);
				}
				return {};
			}

			case 'unload-model': {
				await this.shiryuAiService.unloadModel();
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString('**Model unloaded.** Memory has been freed.'),
				}]);
				return {};
			}

			case 'model-info': {
				const info = this.shiryuAiService.getModelInfo();
				if (info) {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString(
							`**Current Model**\n\n` +
							`- Path: \`${info.modelPath}\`\n` +
							`- Context Size: ${info.contextSize} tokens\n` +
							`- Status: ${info.isLoaded ? 'Loaded' : 'Not loaded'}`
						),
					}]);
				} else {
					progress([{
						kind: 'markdownContent',
						content: new MarkdownString('No model loaded. Use `/load-model <path>` to load one.'),
					}]);
				}
				return {};
			}

			default:
				progress([{
					kind: 'markdownContent',
					content: new MarkdownString(`Unknown command: \`${command}\``),
				}]);
				return {};
		}
	}

	private async _handleToolCalls(
		toolCalls: IShiryuToolCall[],
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<IChatAgentResult> {
		const results = await this.toolService.executeTools(toolCalls, token);

		const parts: string[] = [];
		for (const result of results) {
			if (result.success) {
				parts.push(`**Tool: ${result.name}** — Success`);
				if (result.result) {
					parts.push('```json');
					parts.push(JSON.stringify(result.result, null, 2));
					parts.push('```');
				}
				if (result.images && result.images.length > 0) {
					parts.push(`Generated ${result.images.length} image(s).`);
				}
				if (result.files && result.files.length > 0) {
					parts.push(`Output files: ${result.files.join(', ')}`);
				}
			} else {
				parts.push(`**Tool: ${result.name}** — Error: ${result.error}`);
			}
		}

		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(parts.join('\n\n')),
		}]);

		return {
			metadata: {
				toolCalls: toolCalls.map(c => c.name),
				toolResults: results.map(r => ({ name: r.name, success: r.success })),
			},
		};
	}

	private buildPrompt(message: string, history: IChatAgentHistoryEntry[], includeTools: boolean = false): string {
		const parts: string[] = [];

		// System prompt with tool definitions
		if (includeTools) {
			const toolPrompt = this.toolService.generateToolPrompt();
			if (toolPrompt) {
				parts.push(toolPrompt);
				parts.push('');
			}
		}

		if (history.length > 0) {
			parts.push('Previous conversation:');
			for (const entry of history.slice(-5)) {
				parts.push(`User: ${entry.request.message}`);
				const responseParts = entry.response;
				for (const r of responseParts) {
					if (r.kind === 'markdownContent') {
						parts.push(`Assistant: ${(r as IChatMarkdownContent).content.value}`);
					}
				}
			}
			parts.push('');
		}

		parts.push(`User: ${message}`);
		parts.push('Assistant:');

		return parts.join('\n');
	}
}

//#endregion

//#region Contribution Registration

class ShiryuAiContribution extends Disposable {

	static readonly ID = 'shiryuAi.contribution';

	private readonly _disposables = new DisposableStore();

	constructor(
		@IShiryuAiService private readonly shiryuAiService: IShiryuAiService,
		@IShiryuToolService private readonly toolService: IShiryuToolService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this._registerAgents();
		this._registerToolProviders();
	}

	private _registered = false;

	private async _registerAgents(): Promise<void> {
		if (this._registered) {
			return;
		}

		this.logService.info('[ShiryuAI] Scanning for models and registering agents...');

		// 1. Register the default generic agent (no bound model)
		const genericData = createAgentData('Shiryu AI', 'Generic local AI — load any model via slash command.', '');
		const genericAgent = new ShiryuAiAgent(this.shiryuAiService, this.toolService, this.logService);
		const disposable = this.chatAgentService.registerDynamicAgent(genericData, genericAgent);
		this._disposables.add(disposable);

		// 2. Scan for downloaded GGUF models
		const downloadDir = this.configurationService.getValue<string>('shiryuAi.downloadDir');
		const modelsDir = URI.file(downloadDir || '~/.shiryu-ai-studio/models');

		try {
			const stat = await this.fileService.resolve(modelsDir);
			if (stat.children) {
				for (const child of stat.children) {
					if (child.name.endsWith('.gguf') && !child.name.startsWith('mmproj')) {
						const modelFsPath = child.resource.fsPath;
						const modelName = child.name.replace('.gguf', '');

						const fileSize = child.size ?? 0;

						// Skip if it's just a vision adapter or very small
						if (fileSize < 500_000_000) {
							continue;
						}

						const agentData = createAgentData(modelName,
							`Local AI — ${modelName} (${this._formatSize(fileSize)})`,
							modelFsPath);

						const boundAgent = new ShiryuAiAgent(
							this.shiryuAiService,
							this.toolService,
							this.logService,
							modelFsPath,
						);

						this._disposables.add(
							this.chatAgentService.registerDynamicAgent(agentData, boundAgent)
						);

						this.logService.info(`[ShiryuAI] Registered agent for: ${modelName}`);
					}
				}
			}
		} catch {
			// Models directory might not exist yet
			this.logService.info('[ShiryuAI] No models directory found');
		}

		this._registered = true;

		// Sync Copilot state
		this._syncCopilotState();
		this._disposables.add(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('shiryuAi.enableCopilot')) {
					this._syncCopilotState();
				}
			})
		);

		this.logService.info('[ShiryuAI] Agent registration complete');
	}

	private _formatSize(bytes: number): string {
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
		if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	private _registerToolProviders(): void {
		// Import and register tool providers
		import('../common/shiryuAiComfyUI.js').then(({ ComfyUIToolProvider }) => {
			const comfyuiUrl = this.configurationService.getValue<string>('shiryuAi.comfyuiUrl') || 'http://localhost:8188';
			const provider = new ComfyUIToolProvider(this.logService, comfyuiUrl);
			this.toolService.registerProvider(provider);
			this._disposables.add(provider);
			this.logService.info('[ShiryuAI] ComfyUI tool provider registered');
		}).catch(err => {
			this.logService.warn(`[ShiryuAI] Failed to register ComfyUI provider: ${err}`);
		});

		import('../common/shiryuAiWhisper.js').then(({ WhisperToolProvider }) => {
			const whisperUrl = this.configurationService.getValue<string>('shiryuAi.whisperUrl') || 'http://localhost:9000';
			const provider = new WhisperToolProvider(this.logService, whisperUrl);
			this.toolService.registerProvider(provider);
			this._disposables.add(provider);
			this.logService.info('[ShiryuAI] Whisper tool provider registered');
		}).catch(err => {
			this.logService.warn(`[ShiryuAI] Failed to register Whisper provider: ${err}`);
		});
	}

	private _syncCopilotState(): void {
		const copilotEnabled = this.configurationService.getValue<boolean>('shiryuAi.enableCopilot') === true;
		const currentDisabled = this.configurationService.getValue<boolean>(ChatConfiguration.AIDisabled) === true;

		// If user enables Copilot, turn off the disable flag
		// If user disables Copilot (default), turn on the disable flag
		if (copilotEnabled && currentDisabled) {
			this.configurationService.updateValue(ChatConfiguration.AIDisabled, false);
			this.logService.info('[ShiryuAI] Copilot re-enabled via shiryuAi.enableCopilot');
		} else if (!copilotEnabled && !currentDisabled) {
			this.configurationService.updateValue(ChatConfiguration.AIDisabled, true);
			this.logService.info('[ShiryuAI] Copilot disabled (Shiryu AI is the primary AI)');
		}
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}
}

// Register the contribution — will initialize when the workbench starts
registerWorkbenchContribution2(
	ShiryuAiContribution.ID,
	ShiryuAiContribution,
	WorkbenchPhase.BlockRestore
);

//#region Model Manager View

const shiryuAiModelManagerIcon = registerIcon(
	'shiryu-ai-model-manager-icon',
	Codicon.robot,
	'Shiryu AI Model Manager view icon',
);

const MODEL_MANAGER_CONTAINER_ID = 'workbench.view.shiryuAiModelManagerContainer';
const MODEL_MANAGER_VIEW_ID = ShiryuAiModelManagerView.ID;

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

const modelManagerContainer = viewContainersRegistry.registerViewContainer(
	{
		id: MODEL_MANAGER_CONTAINER_ID,
		title: localize2('shiryuAiModelManager', 'Shiryu AI Models'),
		icon: shiryuAiModelManagerIcon,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			MODEL_MANAGER_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: true },
		]),
		storageId: MODEL_MANAGER_CONTAINER_ID,
		hideIfEmpty: true,
		order: 2,
	},
	ViewContainerLocation.Sidebar,
);

const modelManagerViewDescriptor: IViewDescriptor = {
	id: MODEL_MANAGER_VIEW_ID,
	name: localize2('shiryuAiModelManagerView', 'Model Manager'),
	containerIcon: shiryuAiModelManagerIcon,
	ctorDescriptor: new SyncDescriptor(ShiryuAiModelManagerView),
	canToggleVisibility: true,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: MODEL_MANAGER_VIEW_ID,
		title: localize2('shiryuAiModelManager.focus', 'Focus Model Manager'),
	},
};

viewsRegistry.registerViews([modelManagerViewDescriptor], modelManagerContainer);

//#endregion

//#region Chat View

const CHAT_VIEW_ID = ShiryuAiChatView.ID;

const chatViewDescriptor: IViewDescriptor = {
	id: CHAT_VIEW_ID,
	name: localize2('shiryuAiChat', 'Chat'),
	containerIcon: shiryuAiModelManagerIcon,
	ctorDescriptor: new SyncDescriptor(ShiryuAiChatView),
	canToggleVisibility: true,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: CHAT_VIEW_ID,
		title: localize2('shiryuAiChat.focus', 'Focus Shiryu AI Chat'),
	},
};

viewsRegistry.registerViews([chatViewDescriptor], modelManagerContainer);

//#endregion

//#region Configuration

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'shiryuAi',
	title: 'Shiryu AI Studio',
	type: 'object',
	properties: {
		'shiryuAi.modelPath': {
			type: 'string',
			default: '',
			description: 'Path to the GGUF model file for local inference. Leave empty to load via slash command.',
		},
		'shiryuAi.contextSize': {
			type: 'number',
			default: 4096,
			minimum: 512,
			maximum: 131072,
			description: 'Context window size in tokens. Larger values use more memory.',
		},
		'shiryuAi.gpuLayers': {
			type: 'number',
			default: -1,
			minimum: -1,
			description: 'Number of GPU layers to offload (-1 = all, 0 = CPU only).',
		},
		'shiryuAi.temperature': {
			type: 'number',
			default: 0.7,
			minimum: 0,
			maximum: 2,
			description: 'Sampling temperature. Higher = more random, lower = more deterministic.',
		},
		'shiryuAi.maxTokens': {
			type: 'number',
			default: 2048,
			minimum: 64,
			maximum: 32768,
			description: 'Maximum number of tokens to generate per response.',
		},
		'shiryuAi.enableCopilot': {
			type: 'boolean',
			default: false,
			description: 'Re-enable GitHub Copilot as a secondary AI provider. When disabled (default), only Shiryu AI is available. Restart required after changing.',
		},
		'shiryuAi.activeProvider': {
			type: 'string',
			default: 'llamaCpp',
			enum: ['llamaCpp', 'ollama'],
			enumDescriptions: [
				'Use llama.cpp with local GGUF model files — fully offline, no dependencies.',
				'Use Ollama for model management — auto-downloads models, supports 100+ models.',
			],
			description: 'Select the AI inference provider. llama.cpp requires GGUF files; Ollama manages models automatically.',
		},
		'shiryuAi.ollamaUrl': {
			type: 'string',
			default: 'http://localhost:11434',
			description: 'URL of the Ollama server. Change if running Ollama on a different machine or port.',
		},
		'shiryuAi.downloadDir': {
			type: 'string',
			default: '',
			description: 'Directory to save downloaded GGUF models. Leave empty for default (~/.shiryu-ai-studio/models).',
		},
		'shiryuAi.comfyuiUrl': {
			type: 'string',
			default: 'http://localhost:8188',
			description: 'URL of the ComfyUI server for image/video generation.',
		},
		'shiryuAi.whisperUrl': {
			type: 'string',
			default: 'http://localhost:9000',
			description: 'URL of the Whisper server for audio transcription.',
		},
		'shiryuAi.enableTools': {
			type: 'boolean',
			default: true,
			description: 'Enable tool calling (ComfyUI, Whisper). The model can invoke external tools when needed.',
		},
		'shiryuAi.huggingFaceToken': {
			type: 'string',
			default: '',
			description: 'Hugging Face API token (optional). Required only for gated/private models. Get one at https://huggingface.co/settings/tokens',
		},
		'shiryuAi.recentModels': {
			type: 'array',
			items: { type: 'string' },
			default: [],
			description: 'Recently loaded model paths (for quick switching).',
		},
	},
});

//#endregion
