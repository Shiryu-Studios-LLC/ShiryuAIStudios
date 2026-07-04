/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IShiryuToolCall } from './shiryuAiTools.js';

//#region Provider Types

export enum ShiryuProviderKind {
	LlamaCpp = 'llamaCpp',
	Ollama = 'ollama',
}

export interface IShiryuProviderInfo {
	kind: ShiryuProviderKind;
	name: string;
	isAvailable: boolean;
}

//#endregion

//#region Configuration

export interface IShiryuModelConfig {
	/** Path to the GGUF model file (for llama.cpp) or model name (for Ollama) */
	modelPath: string;
	/** Context window size (default: 4096) */
	contextSize?: number;
	/** Number of GPU layers to offload (0 = CPU only, -1 = all) */
	gpuLayers?: number;
	/** Temperature for sampling (0.0 - 2.0) */
	temperature?: number;
	/** Top-p sampling */
	topP?: number;
	/** Top-k sampling */
	topK?: number;
	/** Max tokens to generate */
	maxTokens?: number;
}

//#endregion

//#region Service Interface

export const IShiryuAiService = createDecorator<IShiryuAiService>('shiryuAiService');

export interface IShiryuAiService {
	_serviceBrand: undefined;

	/** Currently active provider */
	readonly activeProvider: ShiryuProviderKind;

	/** Whether a model backend is available */
	readonly isAvailable: boolean;

	/** Emitted when availability changes (e.g. model loaded/unloaded) */
	readonly onDidChangeAvailability: Event<boolean>;

	/** Emitted when the model starts/stops generating */
	readonly onDidChangeBusy: Event<boolean>;

	/** Whether the model is currently generating a response */
	readonly isBusy: boolean;

	/** List available models from the active provider */
	listModels(): Promise<string[]>;

	/** Load a model. For llama.cpp: GGUF file path. For Ollama: model name. */
	loadModel(config: IShiryuModelConfig): Promise<void>;

	/** Unload the current model and free resources */
	unloadModel(): Promise<void>;

	/** Send a prompt to the model and stream the response via onToken */
	sendPrompt(
		prompt: string,
		onToken: (token: string) => void,
		token: CancellationToken
	): Promise<IShiryuAiResponse>;

	/** Get the currently loaded model info, if any */
	getModelInfo(): IShiryuModelInfo | undefined;

	/** Switch to a different provider */
	switchProvider(kind: ShiryuProviderKind): Promise<void>;

	/** Get info about all available providers */
	getProviders(): IShiryuProviderInfo[];
}

//#endregion

//#region Response Types

export interface IShiryuAiResponse {
	/** The full generated text */
	text: string;
	/** Number of tokens generated */
	tokenCount: number;
	/** Timing info in milliseconds */
	durationMs: number;
	/** Tokens per second */
	tokensPerSecond: number;
	/** Tool calls extracted from the response */
	toolCalls?: IShiryuToolCall[];
}

export interface IShiryuModelInfo {
	modelPath: string;
	contextSize: number;
	isLoaded: boolean;
	provider: ShiryuProviderKind;
}

//#endregion
