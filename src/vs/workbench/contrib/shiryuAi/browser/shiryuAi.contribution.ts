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
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { ShiryuAiModelManagerView } from './shiryuAiModelManagerView.js';

//#region Agent Data

const SHIRYU_AI_AGENT_ID = 'shiryu-ai-studio';

const shiryuAiAgentData: IChatAgentData = {
	id: SHIRYU_AI_AGENT_ID,
	name: 'Shiryu AI',
	fullName: 'Shiryu AI Studio',
	description: 'Local AI powered by llama.cpp — runs on your hardware, no cloud required.',
	isDefault: true,
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
			description: 'Local AI inference using llama.cpp — runs entirely on your machine',
			examples: ['write a function', 'fix this bug', 'explain this code', 'refactor this'],
		},
	],
	metadata: {
		themeIcon: { id: 'robot' },
		helpTextPrefix: 'Shiryu AI runs locally on your machine using llama.cpp.',
		followupPlaceholder: 'Ask Shiryu AI anything...',
	},
	capabilities: {
		supportsFileAttachments: false,
		supportsToolAttachments: false,
	},
};

//#endregion

//#region Agent Implementation

class ShiryuAiAgent implements IChatAgentImplementation {

	constructor(
		private readonly shiryuAiService: IShiryuAiService,
		private readonly logService: ILogService,
	) { }

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

		// Build the prompt with conversation history
		const fullPrompt = this.buildPrompt(request.message, history);

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

	private buildPrompt(message: string, history: IChatAgentHistoryEntry[]): string {
		const parts: string[] = [];

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
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._registerAgent();
	}

	private _registered = false;

	private _registerAgent(): void {
		if (this._registered) {
			return;
		}

		this.logService.info('[ShiryuAI] Initializing Shiryu AI Studio agent...');

		const agentImpl = new ShiryuAiAgent(this.shiryuAiService, this.logService);

		const disposable = this.chatAgentService.registerDynamicAgent(
			shiryuAiAgentData,
			agentImpl
		);

		this._disposables.add(disposable);
		this._registered = true;

		// Sync Copilot enablement: when shiryuAi.enableCopilot changes,
		// update chat.disableAIFeatures accordingly.
		this._syncCopilotState();
		this._disposables.add(
			this.configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('shiryuAi.enableCopilot')) {
					this._syncCopilotState();
				}
			})
		);

		this.logService.info('[ShiryuAI] Agent registered successfully');
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
	},
});

//#endregion
