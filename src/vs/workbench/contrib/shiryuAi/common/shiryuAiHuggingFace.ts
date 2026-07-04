/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

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

/** Default models to show when search is empty — all verified public repos */
const POPULAR_GGUF_MODELS = [
	'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
	'leafspark/Llama-3.2-11B-Vision-Instruct-GGUF',
	'openbmb/MiniCPM-V-4_5-gguf',
	'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
	'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF',
	'lmstudio-community/Qwen2.5-7B-Instruct-GGUF',
	'TheBloke/Mistral-7B-Instruct-v0.2-GGUF',
	'TheBloke/CodeLlama-7B-Instruct-GGUF',
];

/** Known GGUF files for popular models — used when API fails */
const KNOWN_GGUF_FILES: Record<string, Array<{ path: string; size: number }>> = {
	'unsloth/Qwen2.5-VL-7B-Instruct-GGUF': [
		{ path: 'Qwen2.5-VL-7B-Instruct-Q3_K_M.gguf', size: 3_808_390_016 },
		{ path: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf', size: 4_889_677_280 },
		{ path: 'Qwen2.5-VL-7B-Instruct-Q5_K_M.gguf', size: 5_760_000_000 },
		{ path: 'Qwen2.5-VL-7B-Instruct-Q6_K.gguf', size: 6_700_000_000 },
		{ path: 'Qwen2.5-VL-7B-Instruct-Q8_0.gguf', size: 8_400_000_000 },
	],
	'leafspark/Llama-3.2-11B-Vision-Instruct-GGUF': [
		{ path: 'Llama-3.2-11B-Vision-Instruct.Q4_K_M.gguf', size: 5_963_057_216 },
		{ path: 'Llama-3.2-11B-Vision-Instruct.Q5_K_M.gguf', size: 7_200_000_000 },
		{ path: 'Llama-3.2-11B-Vision-Instruct.Q6_K.gguf', size: 8_500_000_000 },
	],
	'openbmb/MiniCPM-V-4_5-gguf': [
		{ path: 'MiniCPM-V-4_5-Q4_0.gguf', size: 4_773_679_808 },
		{ path: 'MiniCPM-V-4_5-Q4_K_M.gguf', size: 5_026_714_304 },
		{ path: 'MiniCPM-V-4_5-Q5_1.gguf', size: 6_192_553_664 },
		{ path: 'MiniCPM-V-4_5-Q5_K_M.gguf', size: 5_849_946_816 },
	],
	'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF': [
		{ path: 'Qwen2.5-Coder-7B-Instruct-Q3_K_M.gguf', size: 3_400_000_000 },
		{ path: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf', size: 4_600_000_000 },
		{ path: 'Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf', size: 5_500_000_000 },
		{ path: 'Qwen2.5-Coder-7B-Instruct-Q6_K.gguf', size: 6_500_000_000 },
		{ path: 'Qwen2.5-Coder-7B-Instruct-Q8_0.gguf', size: 8_000_000_000 },
	],
	'lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF': [
		{ path: 'Meta-Llama-3.1-8B-Instruct-Q3_K_M.gguf', size: 3_400_000_000 },
		{ path: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', size: 4_600_000_000 },
		{ path: 'Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf', size: 5_500_000_000 },
		{ path: 'Meta-Llama-3.1-8B-Instruct-Q6_K.gguf', size: 6_500_000_000 },
		{ path: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf', size: 8_000_000_000 },
	],
	'lmstudio-community/Qwen2.5-7B-Instruct-GGUF': [
		{ path: 'Qwen2.5-7B-Instruct-Q3_K_M.gguf', size: 3_400_000_000 },
		{ path: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', size: 4_600_000_000 },
		{ path: 'Qwen2.5-7B-Instruct-Q5_K_M.gguf', size: 5_500_000_000 },
		{ path: 'Qwen2.5-7B-Instruct-Q6_K.gguf', size: 6_500_000_000 },
		{ path: 'Qwen2.5-7B-Instruct-Q8_0.gguf', size: 8_000_000_000 },
	],
	'TheBloke/Mistral-7B-Instruct-v0.2-GGUF': [
		{ path: 'mistral-7b-instruct-v0.2.Q3_K_M.gguf', size: 3_400_000_000 },
		{ path: 'mistral-7b-instruct-v0.2.Q4_K_M.gguf', size: 4_600_000_000 },
		{ path: 'mistral-7b-instruct-v0.2.Q5_K_M.gguf', size: 5_500_000_000 },
		{ path: 'mistral-7b-instruct-v0.2.Q6_K.gguf', size: 6_500_000_000 },
		{ path: 'mistral-7b-instruct-v0.2.Q8_0.gguf', size: 8_000_000_000 },
	],
	'TheBloke/CodeLlama-7B-Instruct-GGUF': [
		{ path: 'codellama-7b-instruct.Q3_K_M.gguf', size: 3_400_000_000 },
		{ path: 'codellama-7b-instruct.Q4_K_M.gguf', size: 4_600_000_000 },
		{ path: 'codellama-7b-instruct.Q5_K_M.gguf', size: 5_500_000_000 },
		{ path: 'codellama-7b-instruct.Q6_K.gguf', size: 6_500_000_000 },
	],
};

export class HuggingFaceProvider extends Disposable {

	constructor(
		private readonly _logService: ILogService,
		private readonly _fileService: IFileService,
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
					'User-Agent': 'ShiryuAIStudio/1.0',
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
	async getModelFiles(modelId: string, hfToken?: string): Promise<IHuggingFaceModelDetail> {
		try {
			// Try the tree API first, fall back to repo info API
			let allFiles: Array<{ path: string; size: number; lfs?: { size: number; sha256: string } }> = [];

			// Method 1: tree API
			const treeUrl = `https://huggingface.co/api/models/${modelId}/tree/main`;
			const headers: Record<string, string> = {
				'Accept': 'application/json',
				'User-Agent': 'ShiryuAIStudio/1.0',
			};
			if (hfToken) {
				headers['Authorization'] = `Bearer ${hfToken}`;
			}

			this._logService.info(`[ShiryuAI/HF] Fetching files: ${treeUrl}`);
			let response = await fetch(treeUrl, {
				method: 'GET',
				headers,
				signal: AbortSignal.timeout(15000),
			});

			if (response.ok) {
				allFiles = await response.json();
			} else {
				// Method 2: repo info API (different endpoint)
				this._logService.info(`[ShiryuAI/HF] Tree API failed (${response.status}), trying repo info...`);
				const infoUrl = `https://huggingface.co/api/models/${modelId}`;
				response = await fetch(infoUrl, {
					method: 'GET',
					headers: { ...headers, 'Accept': 'application/json' },
					signal: AbortSignal.timeout(15000),
				});

				if (response.ok) {
					const repoInfo = await response.json();
					// Try siblings array from repo info
					if (repoInfo.siblings) {
						allFiles = repoInfo.siblings
							.filter((s: { rfilename: string; size?: number }) => s.rfilename?.endsWith('.gguf'))
							.map((s: { rfilename: string; size?: number }) => ({
								path: s.rfilename,
								size: s.size || 0,
							}));
					}
				}

				// Method 3: direct HuggingFace page scraping
				if (allFiles.length === 0) {
					this._logService.info(`[ShiryuAI/HF] Trying direct page fetch...`);
					const pageUrl = `https://huggingface.co/${modelId}`;
					response = await fetch(pageUrl, {
						method: 'GET',
						headers: { 'Accept': 'text/html' },
						signal: AbortSignal.timeout(15000),
					});
					if (response.ok) {
						const html = await response.text();
						// Extract GGUF file links from HTML
						const ggufRegex = /href="[^"]*\/(\/resolve\/main\/([^"]*\.gguf))"/g;
						let match;
						while ((match = ggufRegex.exec(html)) !== null) {
							allFiles.push({ path: match[2], size: 0 });
						}
						// Also try data-filename patterns
						const dataRegex = /data-filename="([^"]*\.gguf)"/g;
						while ((match = dataRegex.exec(html)) !== null) {
							if (!allFiles.some(f => f.path === match![1])) {
								allFiles.push({ path: match![1], size: 0 });
							}
						}
					}
				}
			}

			// Method 4: hardcoded fallback for known popular models
			if (allFiles.length === 0) {
				const known = KNOWN_GGUF_FILES[modelId];
				if (known) {
					this._logService.info(`[ShiryuAI/HF] Using hardcoded file list for ${modelId}`);
					allFiles = known.map(f => ({ path: f.path, size: f.size }));
				}
			}

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
			headers: { 'User-Agent': 'ShiryuAIStudio/1.0' },
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

		// Write to file using VS Code's file service
		const destUri = URI.file(destPath);

		// Ensure parent directory exists
		const parentDir = destPath.substring(0, destPath.lastIndexOf('\\') !== -1 ? destPath.lastIndexOf('\\') : destPath.lastIndexOf('/'));
		if (parentDir) {
			try {
				await this._fileService.createFolder(URI.file(parentDir));
			} catch {
				// directory may already exist
			}
		}

		await this._fileService.writeFile(destUri, VSBuffer.wrap(result));
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
