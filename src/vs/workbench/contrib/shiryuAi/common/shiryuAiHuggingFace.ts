/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';

//#region Hugging Face API types

export interface IHuggingFaceModel {
	id: string;
	modelId: string;
	author: string;
	private: boolean;
	gated: boolean;
	disabled: boolean;
	lastModified: string;
	tags: string[];
	pipeline_tag: string;
	/** Download count */
	downloads: number;
	/** Likes count */
	likes: number;
}

export interface IHuggingFaceGgufFile {
	filename: string;
	path: string;
	size: number;
	lfs?: {
		size: number;
		sha256: string;
	};
}

export interface IHuggingFaceModelDetail {
	modelId: string;
	author: string;
	/** All GGUF files available */
	ggufFiles: IHuggingFaceGgufFile[];
	/** Total size of all GGUF files */
	totalSize: number;
	/** Number of GGUF files */
	fileCount: number;
}

//#endregion

const HF_API_BASE = 'https://huggingface.co/api';
const HF_SEARCH_URL = `${HF_API_BASE}/models`;

/** Default models to show when search is empty */
const POPULAR_GGUF_MODELS = [
	'TheBloke/Llama-2-7B-Chat-GGUF',
	'TheBloke/CodeLlama-7B-Instruct-GGUF',
	'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
	'TheBloke/Phi-2-GGUF',
	'TheBloke/Qwen2.5-7B-Instruct-GGUF',
	'TheBloke/DeepSeek-Coder-6.7B-Instruct-GGUF',
	'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
	'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
	'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF',
	'lmstudio-community/Qwen2.5-7B-Instruct-GGUF',
];

export class HuggingFaceProvider extends Disposable {

	constructor(
		private readonly _logService: ILogService,
	) {
		super();
	}

	/** Search for GGUF models on Hugging Face */
	async searchModels(query: string = '', limit: number = 20): Promise<IHuggingFaceModel[]> {
		try {
			// Build search URL
			const params = new URLSearchParams({
				limit: String(limit),
				sort: 'downloads',
				direction: '-1',
				filter: 'gguf',
			});

			if (query) {
				params.set('search', query);
			}

			const url = `${HF_SEARCH_URL}?${params.toString()}`;
			this._logService.info(`[ShiryuAI/HF] Searching: ${url}`);

			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
				},
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				throw new Error(`Hugging Face API error: ${response.status} ${response.statusText}`);
			}

			const data: IHuggingFaceModel[] = await response.json();
			return data;
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.warn(`[ShiryuAI/HF] Search failed: ${errorMsg}`);
			return [];
		}
	}

	/** Get GGUF files for a specific model */
	async getModelFiles(modelId: string): Promise<IHuggingFaceModelDetail> {
		try {
			const url = `${HF_API_BASE}/models/${modelId}/tree/main`;
			this._logService.info(`[ShiryuAI/HF] Fetching files: ${url}`);

			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
				},
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch model files: ${response.status}`);
			}

			const allFiles: Array<{ path: string; size: number; lfs?: { size: number; sha256: string } }> = await response.json();

			// Filter to GGUF files only
			const ggufFiles: IHuggingFaceGgufFile[] = allFiles
				.filter(f => f.path.endsWith('.gguf'))
				.map(f => ({
					filename: f.path.split('/').pop() || f.path,
					path: f.path,
					size: f.size,
					lfs: f.lfs,
				}));

			// Extract author from model ID
			const parts = modelId.split('/');
			const author = parts.length > 1 ? parts[0] : 'unknown';

			const totalSize = ggufFiles.reduce((sum, f) => sum + f.size, 0);

			return {
				modelId,
				author,
				ggufFiles,
				totalSize,
				fileCount: ggufFiles.length,
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI/HF] Failed to get model files: ${errorMsg}`);
			throw err;
		}
	}

	/** Get the download URL for a specific GGUF file */
	getDownloadUrl(modelId: string, filePath: string): string {
		return `https://huggingface.co/${modelId}/resolve/main/${filePath}`;
	}

	/** Get popular/default models when search is empty */
	getPopularModels(): string[] {
		return [...POPULAR_GGUF_MODELS];
	}

	/** Download a GGUF file with progress tracking */
	async downloadFile(
		modelId: string,
		filePath: string,
		destPath: string,
		onProgress?: (bytesDownloaded: number, totalBytes: number, percent: number) => void,
		signal?: AbortSignal,
	): Promise<string> {
		const url = this.getDownloadUrl(modelId, filePath);
		this._logService.info(`[ShiryuAI/HF] Downloading: ${url}`);

		const response = await fetch(url, {
			method: 'GET',
			signal,
		});

		if (!response.ok) {
			throw new Error(`Download failed: ${response.status} ${response.statusText}`);
		}

		const contentLength = Number(response.headers.get('content-length')) || 0;
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const chunks: Uint8Array[] = [];
		let bytesDownloaded = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			chunks.push(value);
			bytesDownloaded += value.length;

			if (onProgress && contentLength > 0) {
				const percent = Math.round((bytesDownloaded / contentLength) * 100);
				onProgress(bytesDownloaded, contentLength, percent);
			}
		}

		// Combine all chunks
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const result = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}

		// Write to file using Node.js fs
		const fs = await import('fs');
		const path = await import('path');

		// Ensure directory exists
		const dir = path.dirname(destPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(destPath, result);
		this._logService.info(`[ShiryuAI/HF] Downloaded: ${destPath} (${this.formatSize(totalBytes)})`);

		return destPath;
	}

	/** Format bytes to human readable */
	formatSize(bytes: number): string {
		if (bytes === 0) {
			return '0 B';
		}
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}
}
