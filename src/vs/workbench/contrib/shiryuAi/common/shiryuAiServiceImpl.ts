/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IShiryuAiService, IShiryuAiResponse, IShiryuModelConfig, IShiryuModelInfo, IShiryuProviderInfo, ShiryuProviderKind } from './shiryuAiService.js';
import { OllamaProvider } from './shiryuAiOllama.js';

//#region node-llama-cpp dynamic import

interface LlamaModel {
	dispose(): void;
}

interface LlamaContext {
	dispose(): void;
	createCompletion(prompt: string, options: {
		onTextChunk?: (chunk: string) => void;
		maxTokens?: number;
		temperature?: number;
		topP?: number;
		topK?: number;
		stopSequences?: string[];
	}): Promise<{ text: string }>;
}

interface LlamaChatSession {
	prompt(message: string, options?: {
		onTextChunk?: (chunk: string) => void;
		maxTokens?: number;
		temperature?: number;
	}): Promise<string>;
	dispose(): void;
}

interface Llama {
	loadModel(options: { modelPath: string; gpuLayers?: number }): Promise<LlamaModel>;
	createContext(options: { model: LlamaModel; contextSize?: number }): Promise<LlamaContext>;
	createChatSession(options: { contextSequence: LlamaContext }): LlamaChatSession;
	dispose(): void;
}

let _llamaModule: typeof import('node-llama-cpp') | undefined;

async function loadLlamaModule(): Promise<typeof import('node-llama-cpp') | undefined> {
	if (_llamaModule) {
		return _llamaModule;
	}
	try {
		_llamaModule = await import('node-llama-cpp');
		return _llamaModule;
	} catch {
		return undefined;
	}
}

//#endregion

//#region Implementation

export class ShiryuAiService extends Disposable implements IShiryuAiService {

	declare _serviceBrand: undefined;

	// llama.cpp state
	private _llama: Llama | undefined;
	private _llamaModel: LlamaModel | undefined;
	private _context: LlamaContext | undefined;
	private _chatSession: LlamaChatSession | undefined;
	private _modelConfig: IShiryuModelConfig | undefined;

	// Provider management
	private _activeProvider: ShiryuProviderKind = ShiryuProviderKind.LlamaCpp;
	private _ollamaProvider: OllamaProvider;

	private readonly _onDidChangeAvailability = new Emitter<boolean>();
	readonly onDidChangeAvailability = this._onDidChangeAvailability.event;

	private readonly _onDidChangeBusy = new Emitter<boolean>();
	readonly onDidChangeBusy = this._onDidChangeBusy.event;

	private _busy = false;

	get activeProvider(): ShiryuProviderKind {
		return this._activeProvider;
	}

	get isAvailable(): boolean {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			return this._ollamaProvider.isAvailable;
		}
		return this._llamaModel !== undefined && this._context !== undefined;
	}

	get isBusy(): boolean {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			return this._ollamaProvider.isBusy;
		}
		return this._busy;
	}

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._ollamaProvider = this._register(
			new OllamaProvider(this.logService)
		);

		// Forward Ollama events
		this._register(this._ollamaProvider.onDidChangeAvailability(enabled => {
			if (this._activeProvider === ShiryuProviderKind.Ollama) {
				this._onDidChangeAvailability.fire(enabled);
			}
		}));
		this._register(this._ollamaProvider.onDidChangeBusy(busy => {
			if (this._activeProvider === ShiryuProviderKind.Ollama) {
				this._onDidChangeBusy.fire(busy);
			}
		}));
	}

	override dispose(): void {
		this._onDidChangeAvailability.dispose();
		this._onDidChangeBusy.dispose();
		super.dispose();
	}

	//#region Provider Management

	getProviders(): IShiryuProviderInfo[] {
		return [
			{
				kind: ShiryuProviderKind.LlamaCpp,
				name: 'llama.cpp (Local GGUF)',
				isAvailable: this._llamaModel !== undefined,
			},
			{
				kind: ShiryuProviderKind.Ollama,
				name: 'Ollama',
				isAvailable: this._ollamaProvider.isAvailable,
			},
		];
	}

	async switchProvider(kind: ShiryuProviderKind): Promise<void> {
		if (kind === this._activeProvider) {
			return;
		}

		this.logService.info(`[ShiryuAI] Switching provider: ${this._activeProvider} -> ${kind}`);

		// Unload current provider
		if (this.isAvailable) {
			await this.unloadModel();
		}

		this._activeProvider = kind;

		// If switching to Ollama, check connection
		if (kind === ShiryuProviderKind.Ollama) {
			const connected = await this._ollamaProvider.checkConnection();
			if (!connected) {
				this.logService.warn('[ShiryuAI] Ollama server not reachable at localhost:11434');
			}
		}
	}

	//#endregion

	//#region Model Management

	async listModels(): Promise<string[]> {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			return this._ollamaProvider.listModels();
		}

		// For llama.cpp, we can't list — user must provide path
		return [];
	}

	async loadModel(config: IShiryuModelConfig): Promise<void> {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			await this._ollamaProvider.loadModel(config.modelPath);
			this._modelConfig = config;
			return;
		}

		// llama.cpp path
		this.logService.info(`[ShiryuAI] Loading model: ${config.modelPath}`);

		const llamaModule = await loadLlamaModule();
		if (!llamaModule) {
			throw new Error(
				'[ShiryuAI] node-llama-cpp is not installed. ' +
				'Run "npm install node-llama-cpp" in the ShiryuAIStudios root to enable local AI inference.'
			);
		}

		// Unload any existing model first
		await this.unloadModel();

		try {
			const llama = await llamaModule.getLlama();
			this._llama = llama as unknown as Llama;

			const gpuLayers = config.gpuLayers ?? -1;
			this._llamaModel = await (this._llama as any).loadModel({
				modelPath: config.modelPath,
				gpuLayers,
			}) as LlamaModel;

			const contextSize = config.contextSize ?? 4096;
			this._context = await (this._llama as any).createContext({
				model: this._llamaModel,
				contextSize,
			}) as LlamaContext;

			this._chatSession = (this._llama as any).createChatSession({
				contextSequence: this._context,
			}) as LlamaChatSession;

			this._modelConfig = config;
			this._onDidChangeAvailability.fire(true);
			this.logService.info(`[ShiryuAI] Model loaded successfully: ${config.modelPath}`);
		} catch (err) {
			// Cleanup on failure
			await this.unloadModel();
			throw err;
		}
	}

	async unloadModel(): Promise<void> {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			await this._ollamaProvider.unloadModel();
			this._modelConfig = undefined;
			return;
		}

		// llama.cpp cleanup
		if (this._chatSession) {
			this._chatSession.dispose();
			this._chatSession = undefined;
		}
		if (this._context) {
			this._context.dispose();
			this._context = undefined;
		}
		if (this._llamaModel) {
			this._llamaModel.dispose();
			this._llamaModel = undefined;
		}
		if (this._llama) {
			(this._llama as any).dispose?.();
			this._llama = undefined;
		}
		this._modelConfig = undefined;
		this._onDidChangeAvailability.fire(false);
		this.logService.info('[ShiryuAI] Model unloaded');
	}

	//#endregion

	//#region Prompt / Inference

	async sendPrompt(
		prompt: string,
		onToken: (token: string) => void,
		token: CancellationToken
	): Promise<IShiryuAiResponse> {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			return this._ollamaProvider.sendPrompt(prompt, onToken, token);
		}

		// llama.cpp path
		if (!this._chatSession || !this.isAvailable) {
			throw new Error('[ShiryuAI] No model loaded. Call loadModel() first.');
		}

		if (this._busy) {
			throw new Error('[ShiryuAI] Model is busy generating a response.');
		}

		this._busy = true;
		this._onDidChangeBusy.fire(true);

		const startTime = Date.now();
		let tokenCount = 0;

		try {
			const fullText = await this._chatSession.prompt(prompt, {
				onTextChunk: (chunk: string) => {
					if (token.isCancellationRequested) {
						return;
					}
					tokenCount++;
					onToken(chunk);
				},
				maxTokens: this._modelConfig?.maxTokens ?? 2048,
				temperature: this._modelConfig?.temperature ?? 0.7,
			});

			const durationMs = Date.now() - startTime;
			const tokensPerSecond = durationMs > 0 ? (tokenCount / durationMs) * 1000 : 0;

			return {
				text: fullText,
				tokenCount,
				durationMs,
				tokensPerSecond,
			};
		} finally {
			this._busy = false;
			this._onDidChangeBusy.fire(false);
		}
	}

	//#endregion

	//#region Model Info

	getModelInfo(): IShiryuModelInfo | undefined {
		if (this._activeProvider === ShiryuProviderKind.Ollama) {
			return this._ollamaProvider.getModelInfo();
		}

		if (!this._modelConfig) {
			return undefined;
		}
		return {
			modelPath: this._modelConfig.modelPath,
			contextSize: this._modelConfig.contextSize ?? 4096,
			isLoaded: this.isAvailable,
			provider: ShiryuProviderKind.LlamaCpp,
		};
	}

	//#endregion
}

//#endregion
