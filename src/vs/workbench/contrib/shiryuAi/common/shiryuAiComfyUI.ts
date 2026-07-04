/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IShiryuToolProvider, IShiryuToolDefinition, IShiryuToolResult } from './shiryuAiTools.js';

//#region ComfyUI API types

interface ComfyUIHistoryEntry {
	status: { status_str: string; completed: boolean };
	output: {
		images?: Array<{
			filename: string;
			subfolder: string;
			type: string;
		}>;
		gifs?: Array<{
			filename: string;
			subfolder: string;
			type: string;
		}>;
	};
}

//#endregion

export class ComfyUIToolProvider extends Disposable implements IShiryuToolProvider {

	readonly id = 'comfyui';
	readonly name = 'ComfyUI';

	private _baseUrl: string;

	constructor(
		private readonly _logService: ILogService,
		baseUrl?: string,
	) {
		super();
		this._baseUrl = baseUrl || 'http://localhost:8188';
	}

	//#region Tool Definitions

	getTools(): IShiryuToolDefinition[] {
		return [
			{
				name: 'comfyui_generate_image',
				description: 'Generate an image using ComfyUI. Supports text-to-image, image-to-image, and custom workflows. Returns the generated image as base64.',
				provider: this.id,
				parameters: [
					{
						name: 'prompt',
						type: 'string',
						description: 'Text prompt describing the image to generate',
						required: true,
					},
					{
						name: 'negative_prompt',
						type: 'string',
						description: 'What to avoid in the image',
						required: false,
						default: 'blurry, low quality, distorted',
					},
					{
						name: 'width',
						type: 'number',
						description: 'Image width in pixels',
						required: false,
						default: 512,
					},
					{
						name: 'height',
						type: 'number',
						description: 'Image height in pixels',
						required: false,
						default: 512,
					},
					{
						name: 'steps',
						type: 'number',
						description: 'Number of sampling steps (more = better quality, slower)',
						required: false,
						default: 20,
					},
					{
						name: 'cfg_scale',
						type: 'number',
						description: 'Classifier-free guidance scale (higher = more prompt adherence)',
						required: false,
						default: 7.5,
					},
					{
						name: 'seed',
						type: 'number',
						description: 'Random seed for reproducibility (-1 for random)',
						required: false,
						default: -1,
					},
					{
						name: 'sampler',
						type: 'string',
						description: 'Sampling method',
						required: false,
						default: 'euler',
						enum: ['euler', 'euler_a', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'lms'],
					},
				],
			},
			{
				name: 'comfyui_generate_video',
				description: 'Generate a video/animation using ComfyUI with AnimateDiff or similar. Returns frames as base64 images.',
				provider: this.id,
				parameters: [
					{
						name: 'prompt',
						type: 'string',
						description: 'Text prompt for the video',
						required: true,
					},
					{
						name: 'negative_prompt',
						type: 'string',
						description: 'What to avoid',
						required: false,
						default: 'blurry, low quality',
					},
					{
						name: 'frames',
						type: 'number',
						description: 'Number of frames (16, 24, or 32)',
						required: false,
						default: 16,
					},
					{
						name: 'width',
						type: 'number',
						description: 'Frame width',
						required: false,
						default: 512,
					},
					{
						name: 'height',
						type: 'number',
						description: 'Frame height',
						required: false,
						default: 512,
					},
				],
			},
			{
				name: 'comfyui_run_workflow',
				description: 'Execute a custom ComfyUI workflow (JSON). Use for advanced pipelines like ControlNet, inpainting, upscaling.',
				provider: this.id,
				parameters: [
					{
						name: 'workflow',
						type: 'object',
						description: 'ComfyUI workflow JSON',
						required: true,
					},
				],
			},
			{
				name: 'comfyui_status',
				description: 'Check if ComfyUI is running and get server status (queue, connected GPUs, installed models).',
				provider: this.id,
				parameters: [],
			},
			{
				name: 'comfyui_list_models',
				description: 'List available models in ComfyUI (checkpoints, LoRAs, VAEs, controlnets).',
				provider: this.id,
				parameters: [
					{
						name: 'type',
						type: 'string',
						description: 'Model type to list',
						required: false,
						enum: ['checkpoint', 'lora', 'vae', 'controlnet', 'all'],
						default: 'all',
					},
				],
			},
		];
	}

	//#endregion

	//#region Tool Execution

	async execute(name: string, args: Record<string, unknown>, token: CancellationToken): Promise<IShiryuToolResult> {
		const id = `comfyui_${Date.now()}`;

		try {
			switch (name) {
				case 'comfyui_generate_image':
					return await this._generateImage(args, token);
				case 'comfyui_generate_video':
					return await this._generateVideo(args, token);
				case 'comfyui_run_workflow':
					return await this._runWorkflow(args, token);
				case 'comfyui_status':
					return await this._getStatus(id);
				case 'comfyui_list_models':
					return await this._listModels(args, id);
				default:
					return { id, name, success: false, error: `Unknown tool: ${name}` };
			}
		} catch (err) {
			return {
				id,
				name,
				success: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			const response = await fetch(`${this._baseUrl}/system_stats`, {
				method: 'GET',
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	//#endregion

	//#region Image Generation

	private async _generateImage(
		args: Record<string, unknown>,
		token: CancellationToken,
	): Promise<IShiryuToolResult> {
		const prompt = args.prompt as string;
		const negativePrompt = (args.negative_prompt as string) || 'blurry, low quality';
		const width = (args.width as number) || 512;
		const height = (args.height as number) || 512;
		const steps = (args.steps as number) || 20;
		const cfgScale = (args.cfg_scale as number) || 7.5;
		const seed = (args.seed as number) ?? -1;
		const sampler = (args.sampler as string) || 'euler';

		this._logService.info(`[ShiryuAI/ComfyUI] Generating image: "${prompt.slice(0, 100)}" ${width}x${height} ${steps} steps`);

		// Build a basic text-to-image workflow
		const workflow = this._buildTxt2ImgWorkflow(prompt, negativePrompt, width, height, steps, cfgScale, seed, sampler);

		// Queue the prompt
		const promptId = await this._queuePrompt(workflow);

		// Wait for completion
		const result = await this._waitForCompletion(promptId, token);

		// Get output images
		const images: string[] = [];
		if (result?.output?.images) {
			for (const img of result.output.images) {
				const imageData = await this._getImage(img.filename, img.subfolder, img.type);
				images.push(imageData);
			}
		}

		return {
			id: `comfyui_img_${Date.now()}`,
			name: 'comfyui_generate_image',
			success: images.length > 0,
			result: {
				promptId,
				imageCount: images.length,
				width,
				height,
				steps,
				seed,
			},
			images,
		};
	}

	private _buildTxt2ImgWorkflow(
		prompt: string,
		negativePrompt: string,
		width: number,
		height: number,
		steps: number,
		cfgScale: number,
		seed: number,
		sampler: string,
	): Record<string, unknown> {
		const actualSeed = seed === -1 ? Math.floor(Math.random() * 2147483647) : seed;

		return {
			"3": {
				"inputs": {
					"seed": actualSeed,
					"steps": steps,
					"cfg": cfgScale,
					"sampler_name": sampler,
					"scheduler": "normal",
					"denoise": 1.0,
					"model": ["4", 0],
					"positive": ["6", 0],
					"negative": ["7", 0],
					"latent_image": ["5", 0],
				},
				"class_type": "KSampler",
			},
			"4": {
				"inputs": {
					"ckpt_name": "sd_xl_base_1.0.safetensors",
				},
				"class_type": "CheckpointLoaderSimple",
			},
			"5": {
				"inputs": {
					"width": width,
					"height": height,
					"batch_size": 1,
				},
				"class_type": "EmptyLatentImage",
			},
			"6": {
				"inputs": {
					"text": prompt,
					"clip": ["4", 1],
				},
				"class_type": "CLIPTextEncode",
			},
			"7": {
				"inputs": {
					"text": negativePrompt,
					"clip": ["4", 1],
				},
				"class_type": "CLIPTextEncode",
			},
			"8": {
				"inputs": {
					"samples": ["3", 0],
					"vae": ["4", 2],
				},
				"class_type": "VAEDecode",
			},
			"9": {
				"inputs": {
					"filename_prefix": "shiryu_ai",
					"images": ["8", 0],
				},
				"class_type": "SaveImage",
			},
		};
	}

	//#endregion

	//#region Video Generation

	private async _generateVideo(
		args: Record<string, unknown>,
		token: CancellationToken,
	): Promise<IShiryuToolResult> {
		const prompt = args.prompt as string;
		const negativePrompt = (args.negative_prompt as string) || 'blurry, low quality';
		const frames = (args.frames as number) || 16;
		const width = (args.width as number) || 512;
		const height = (args.height as number) || 512;

		this._logService.info(`[ShiryuAI/ComfyUI] Generating video: "${prompt.slice(0, 100)}" ${frames} frames ${width}x${height}`);

		// Build a basic AnimateDiff workflow (if available)
		const workflow = this._buildVideoWorkflow(prompt, negativePrompt, frames, width, height);
		const promptId = await this._queuePrompt(workflow);
		const result = await this._waitForCompletion(promptId, token);

		const images: string[] = [];
		if (result?.output?.gifs) {
			for (const gif of result.output.gifs) {
				const data = await this._getImage(gif.filename, gif.subfolder, gif.type);
				images.push(data);
			}
		}
		if (result?.output?.images) {
			for (const img of result.output.images) {
				const data = await this._getImage(img.filename, img.subfolder, img.type);
				images.push(data);
			}
		}

		return {
			id: `comfyui_vid_${Date.now()}`,
			name: 'comfyui_generate_video',
			success: images.length > 0,
			result: { promptId, frameCount: images.length },
			images,
		};
	}

	private _buildVideoWorkflow(
		prompt: string,
		negativePrompt: string,
		frames: number,
		width: number,
		height: number,
	): Record<string, unknown> {
		// Placeholder — real AnimateDiff workflow depends on installed models
		return this._buildTxt2ImgWorkflow(prompt, negativePrompt, width, height, 20, 7.5, -1, 'euler');
	}

	//#endregion

	//#region Custom Workflow

	private async _runWorkflow(
		args: Record<string, unknown>,
		token: CancellationToken,
	): Promise<IShiryuToolResult> {
		const workflow = args.workflow as Record<string, unknown>;
		if (!workflow) {
			return {
				id: `comfyui_wf_${Date.now()}`,
				name: 'comfyui_run_workflow',
				success: false,
				error: 'No workflow provided',
			};
		}

		this._logService.info(`[ShiryuAI/ComfyUI] Running custom workflow`);
		const promptId = await this._queuePrompt(workflow);
		const result = await this._waitForCompletion(promptId, token);

		const images: string[] = [];
		if (result?.output?.images) {
			for (const img of result.output.images) {
				images.push(await this._getImage(img.filename, img.subfolder, img.type));
			}
		}

		return {
			id: `comfyui_wf_${Date.now()}`,
			name: 'comfyui_run_workflow',
			success: true,
			result,
			images,
		};
	}

	//#endregion

	//#region Status / Models

	private async _getStatus(id: string): Promise<IShiryuToolResult> {
		try {
			const response = await fetch(`${this._baseUrl}/system_stats`);
			if (!response.ok) {
				return { id, name: 'comfyui_status', success: false, error: `HTTP ${response.status}` };
			}
			const data = await response.json();
			return {
				id,
				name: 'comfyui_status',
				success: true,
				result: data,
			};
		} catch (err) {
			return {
				id,
				name: 'comfyui_status',
				success: false,
				error: `Cannot connect to ComfyUI at ${this._baseUrl}. Is it running?`,
			};
		}
	}

	private async _listModels(
		args: Record<string, unknown>,
		id: string,
	): Promise<IShiryuToolResult> {
		const type = (args.type as string) || 'all';
		try {
			const response = await fetch(`${this._baseUrl}/object_info`);
			if (!response.ok) {
				return { id, name: 'comfyui_list_models', success: false, error: `HTTP ${response.status}` };
			}
			const data = await response.json();

			// Extract model lists from ComfyUI object_info
			const models: Record<string, string[]> = {};
			if (type === 'all' || type === 'checkpoint') {
				models.checkpoints = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
			}
			if (type === 'all' || type === 'lora') {
				models.loras = data.LoraLoader?.input?.required?.lora_name?.[0] || [];
			}
			if (type === 'all' || type === 'vae') {
				models.vaes = data.VAELoader?.input?.required?.vae_name?.[0] || [];
			}
			if (type === 'all' || type === 'controlnet') {
				models.controlnets = data.ControlNetLoader?.input?.required?.control_net_name?.[0] || [];
			}

			return {
				id,
				name: 'comfyui_list_models',
				success: true,
				result: models,
			};
		} catch (err) {
			return {
				id,
				name: 'comfyui_list_models',
				success: false,
				error: `Cannot connect to ComfyUI at ${this._baseUrl}`,
			};
		}
	}

	//#endregion

	//#region API Helpers

	private async _queuePrompt(workflow: Record<string, unknown>): Promise<string> {
		const response = await fetch(`${this._baseUrl}/prompt`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: workflow }),
		});

		if (!response.ok) {
			throw new Error(`ComfyUI queue failed: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return data.prompt_id;
	}

	private async _waitForCompletion(
		promptId: string,
		token: CancellationToken,
		timeoutMs: number = 300000,
	): Promise<ComfyUIHistoryEntry | undefined> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			if (token.isCancellationRequested) {
				throw new Error('Cancelled');
			}

			try {
				const response = await fetch(`${this._baseUrl}/history/${promptId}`);
				if (response.ok) {
					const data = await response.json();
					const entry = data[promptId] as ComfyUIHistoryEntry;
					if (entry?.status?.completed) {
						return entry;
					}
				}
			} catch {
				// ignore
			}

			// Wait before polling again
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		throw new Error(`ComfyUI prompt timed out after ${timeoutMs / 1000}s`);
	}

	private async _getImage(
		filename: string,
		subfolder: string,
		type: string,
	): Promise<string> {
		const params = new URLSearchParams({
			filename,
			subfolder: subfolder || '',
			type: type || 'output',
		});

		const response = await fetch(`${this._baseUrl}/view?${params.toString()}`);
		if (!response.ok) {
			throw new Error(`Failed to fetch image: ${response.status}`);
		}

		const blob = await response.blob();
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				const result = reader.result as string;
				// Strip data URL prefix, return raw base64
				const base64 = result.split(',')[1] || result;
				resolve(base64);
			};
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	}

	//#endregion
}
