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
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IShiryuAiService } from '../common/shiryuAiService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

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
	) {
		super();
	}

	private _registered = false;

	initialize(): void {
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

		this.logService.info('[ShiryuAI] Agent registered successfully');
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

//#endregion
