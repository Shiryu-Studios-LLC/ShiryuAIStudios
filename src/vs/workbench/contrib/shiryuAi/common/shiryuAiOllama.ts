/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IShiryuAiResponse, IShiryuModelInfo, ShiryuProviderKind } from './shiryuAiService.js';

//#region Ollama API types

interface OllamaTagsResponse {
	models: Array<{
		name: string;
		size: number;
		digest: string;
		modified_at: string;
	}>;
}

interface OllamaGenerateResponse {
	model: string;
	response: string;
	done: boolean;
	total_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

//#endregion

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

export class OllamaProvider extends Disposable {

	private _modelLoaded = false;
	private _currentModel: string | undefined;
	private _baseUrl: string;

	private readonly _onDidChangeAvailability = new Emitter<boolean>();
	readonly onDidChangeAvailability = this._onDidChangeAvailability.event;

	private readonly _onDidChangeBusy = new Emitter<boolean>();
	readonly onDidChangeBusy = this._onDidChangeBusy.event;

	private _busy = false;

	get isAvailable(): boolean {
		return this._modelLoaded;
	}

	get isBusy(): boolean {
		return this._busy;
	}

	get currentModel(): string | undefined {
		return this._currentModel;
	}

	constructor(
		private readonly _logService: ILogService,
		baseUrl?: string,
	) {
		super();
		this._baseUrl = baseUrl || OLLAMA_DEFAULT_URL;
	}

	override dispose(): void {
		this._onDidChangeAvailability.dispose();
		this._onDidChangeBusy.dispose();
		super.dispose();
	}

	/** Check if Ollama server is reachable */
	async checkConnection(): Promise<boolean> {
		try {
			const response = await fetch(`${this._baseUrl}/api/tags`, {
				method: 'GET',
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/** List all models available in Ollama */
	async listModels(): Promise<string[]> {
		try {
			const response = await fetch(`${this._baseUrl}/api/tags`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000),
			});

			if (!response.ok) {
				return [];
			}

			const data: OllamaTagsResponse = await response.json();
			return data.models.map(m => m.name);
		} catch (err) {
			this._logService.warn(`[ShiryuAI/Ollama] Failed to list models: ${err}`);
			return [];
		}
	}

	/** Pull (download) a model from Ollama registry */
	async pullModel(
		modelName: string,
		onProgress?: (status: string) => void,
	): Promise<void> {
		this._logService.info(`[ShiryuAI/Ollama] Pulling model: ${modelName}`);
		onProgress?.(`Downloading ${modelName}...`);

		try {
			const response = await fetch(`${this._baseUrl}/api/pull`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: modelName }),
			});

			if (!response.ok) {
				throw new Error(`Ollama pull failed: ${response.status} ${response.statusText}`);
			}

			// Read the streaming response to track progress
			const reader = response.body?.getReader();
			if (reader) {
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					const chunk = decoder.decode(value, { stream: true });
					// Each line is a JSON object with status info
					for (const line of chunk.split('\n')) {
						if (line.trim()) {
							try {
								const progress = JSON.parse(line);
								if (progress.status) {
									onProgress?.(progress.status);
								}
							} catch {
								// ignore parse errors in streaming
							}
						}
					}
				}
			}

			this._logService.info(`[ShiryuAI/Ollama] Model pulled: ${modelName}`);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI/Ollama] Pull failed: ${errorMsg}`);
			throw new Error(`Failed to download model: ${errorMsg}`);
		}
	}

	/** Load (set as active) a model in Ollama */
	async loadModel(modelName: string): Promise<void> {
		this._logService.info(`[ShiryuAI/Ollama] Loading model: ${modelName}`);

		// Ollama doesn't have an explicit "load" — the first generate request loads it
		// We verify the model exists first
		const models = await this.listModels();
		const normalized = modelName.includes(':') ? modelName : `${modelName}:latest`;
		if (!models.some(m => m === normalized || m === modelName)) {
			throw new Error(
				`Model "${modelName}" not found in Ollama. ` +
				`Available models: ${models.length > 0 ? models.join(', ') : 'none — run "ollama pull <model>" first'}`
			);
		}

		this._currentModel = normalized;
		this._modelLoaded = true;
		this._onDidChangeAvailability.fire(true);
		this._logService.info(`[ShiryuAI/Ollama] Model loaded: ${normalized}`);
	}

	/** Unload the current model */
	async unloadModel(): Promise<void> {
		if (this._currentModel) {
			// Ollama keeps models in memory — we can't force unload, but we can clear our state
			this._logService.info(`[ShiryuAI/Ollama] Unloading model: ${this._currentModel}`);
		}
		this._currentModel = undefined;
		this._modelLoaded = false;
		this._onDidChangeAvailability.fire(false);
	}

	/** Send a prompt and stream the response */
	async sendPrompt(
		prompt: string,
		onToken: (token: string) => void,
		token: CancellationToken,
	): Promise<IShiryuAiResponse> {
		if (!this._currentModel) {
			throw new Error('[ShiryuAI/Ollama] No model loaded. Select a model first.');
		}

		if (this._busy) {
			throw new Error('[ShiryuAI/Ollama] Model is busy generating a response.');
		}

		this._busy = true;
		this._onDidChangeBusy.fire(true);

		const startTime = Date.now();
		let tokenCount = 0;
		let fullText = '';

		try {
			const response = await fetch(`${this._baseUrl}/api/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: this._currentModel,
					prompt: prompt,
					stream: true,
				}),
			});

			if (!response.ok) {
				throw new Error(`Ollama generate failed: ${response.status} ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response stream from Ollama');
			}

			const decoder = new TextDecoder();

			while (true) {
				if (token.isCancellationRequested) {
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				const chunk = decoder.decode(value, { stream: true });
				for (const line of chunk.split('\n')) {
					if (!line.trim()) {
						continue;
					}
					try {
						const data: OllamaGenerateResponse = JSON.parse(line);
						if (data.response) {
							tokenCount++;
							fullText += data.response;
							onToken(data.response);
						}
						if (data.done) {
							// Use Ollama's timing data if available
							if (data.total_duration && data.eval_count) {
								const durationMs = data.total_duration / 1_000_000; // nanoseconds to ms
								const tokensPerSecond = data.eval_count / (data.eval_duration ? data.eval_duration / 1_000_000_000 : durationMs / 1000);
								return {
									text: fullText,
									tokenCount: data.eval_count,
									durationMs,
									tokensPerSecond,
								};
							}
						}
					} catch {
						// ignore parse errors in streaming
					}
				}
			}

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

	getModelInfo(): IShiryuModelInfo | undefined {
		if (!this._currentModel) {
			return undefined;
		}
		return {
			modelPath: this._currentModel,
			contextSize: 0, // Ollama manages context internally
			isLoaded: this._modelLoaded,
			provider: ShiryuProviderKind.Ollama,
		};
	}
}
