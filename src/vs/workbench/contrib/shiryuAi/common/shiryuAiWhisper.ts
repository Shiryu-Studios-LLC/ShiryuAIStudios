/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IShiryuToolProvider, IShiryuToolDefinition, IShiryuToolResult } from './shiryuAiTools.js';

//#region Whisper API types

interface WhisperTranscriptionResponse {
	text: string;
	segments?: Array<{
		start: number;
		end: number;
		text: string;
	}>;
	language?: string;
	duration?: number;
}

//#endregion

export class WhisperToolProvider extends Disposable implements IShiryuToolProvider {

	readonly id = 'whisper';
	readonly name = 'Whisper (Audio Transcription)';

	private _baseUrl: string;
	private _defaultModel: string;

	constructor(
		private readonly _logService: ILogService,
		baseUrl?: string,
		defaultModel?: string,
	) {
		super();
		this._baseUrl = baseUrl || 'http://localhost:9000';
		this._defaultModel = defaultModel || 'base';
	}

	//#region Tool Definitions

	getTools(): IShiryuToolDefinition[] {
		return [
			{
				name: 'whisper_transcribe',
				description: 'Transcribe an audio file to text using Whisper. Supports mp3, wav, m4a, flac, ogg formats.',
				provider: this.id,
				parameters: [
					{
						name: 'audio_path',
						type: 'string',
						description: 'Path to the audio file to transcribe',
						required: true,
					},
					{
						name: 'language',
						type: 'string',
						description: 'Language code (en, es, fr, de, ja, zh, etc.). Auto-detect if not specified.',
						required: false,
					},
					{
						name: 'model',
						type: 'string',
						description: 'Whisper model size (tiny, base, small, medium, large)',
						required: false,
						default: 'base',
						enum: ['tiny', 'base', 'small', 'medium', 'large'],
					},
				],
			},
			{
				name: 'whisper_translate',
				description: 'Translate audio to English text using Whisper.',
				provider: this.id,
				parameters: [
					{
						name: 'audio_path',
						type: 'string',
						description: 'Path to the audio file to translate',
						required: true,
					},
					{
						name: 'model',
						type: 'string',
						description: 'Whisper model size',
						required: false,
						default: 'base',
						enum: ['tiny', 'base', 'small', 'medium', 'large'],
					},
				],
			},
			{
				name: 'whisper_status',
				description: 'Check if Whisper server is running and which models are available.',
				provider: this.id,
				parameters: [],
			},
		];
	}

	//#endregion

	//#region Tool Execution

	async execute(name: string, args: Record<string, unknown>, token: CancellationToken): Promise<IShiryuToolResult> {
		const id = `whisper_${Date.now()}`;

		try {
			switch (name) {
				case 'whisper_transcribe':
					return await this._transcribe(args, false, token);
				case 'whisper_translate':
					return await this._transcribe(args, true, token);
				case 'whisper_status':
					return await this._getStatus(id);
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
			const response = await fetch(`${this._baseUrl}/health`, {
				method: 'GET',
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	//#endregion

	//#region Transcription

	private async _transcribe(
		args: Record<string, unknown>,
		translate: boolean,
		token: CancellationToken,
	): Promise<IShiryuToolResult> {
		const audioPath = args.audio_path as string;
		const language = args.language as string | undefined;
		const model = (args.model as string) || this._defaultModel;

		if (!audioPath) {
			return {
				id: `whisper_${Date.now()}`,
				name: translate ? 'whisper_translate' : 'whisper_transcribe',
				success: false,
				error: 'No audio_path provided',
			};
		}

		this._logService.info(`[ShiryuAI/Whisper] Transcribing: ${audioPath} (model=${model}, translate=${translate})`);

		// Read the audio file
		const fs = await import('fs');
		const path = await import('path');

		if (!fs.existsSync(audioPath)) {
			return {
				id: `whisper_${Date.now()}`,
				name: translate ? 'whisper_translate' : 'whisper_transcribe',
				success: false,
				error: `Audio file not found: ${audioPath}`,
			};
		}

		const audioBuffer = fs.readFileSync(audioPath);
		const fileName = path.basename(audioPath);

		// Determine MIME type
		const ext = path.extname(audioPath).toLowerCase();
		const mimeMap: Record<string, string> = {
			'.mp3': 'audio/mpeg',
			'.wav': 'audio/wav',
			'.m4a': 'audio/mp4',
			'.flac': 'audio/flac',
			'.ogg': 'audio/ogg',
			'.webm': 'audio/webm',
		};
		const mimeType = mimeMap[ext] || 'audio/mpeg';

		// Build multipart form data
		const formData = new FormData();
		const blob = new Blob([audioBuffer], { type: mimeType });
		formData.append('audio_file', blob, fileName);
		formData.append('model', model);
		formData.append('response_format', 'json');

		if (language) {
			formData.append('language', language);
		}

		if (translate) {
			formData.append('task', 'translate');
		}

		// Send to Whisper server
		const endpoint = translate ? '/v1/audio/translate' : '/v1/audio/transcriptions';
		const response = await fetch(`${this._baseUrl}${endpoint}`, {
			method: 'POST',
			body: formData,
			signal: AbortSignal.timeout(300000), // 5 min timeout for long audio
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Whisper API error: ${response.status} — ${errorText}`);
		}

		const data: WhisperTranscriptionResponse = await response.json();

		this._logService.info(`[ShiryuAI/Whisper] Transcription complete: ${data.text.length} chars`);

		return {
			id: `whisper_${Date.now()}`,
			name: translate ? 'whisper_translate' : 'whisper_transcribe',
			success: true,
			result: {
				text: data.text,
				segments: data.segments,
				language: data.language,
				duration: data.duration,
				fileName,
				model,
			},
		};
	}

	//#endregion

	//#region Status

	private async _getStatus(id: string): Promise<IShiryuToolResult> {
		try {
			const response = await fetch(`${this._baseUrl}/health`);
			if (!response.ok) {
				return { id, name: 'whisper_status', success: false, error: `HTTP ${response.status}` };
			}
			const data = await response.json();
			return {
				id,
				name: 'whisper_status',
				success: true,
				result: {
					...data,
					baseUrl: this._baseUrl,
				},
			};
		} catch {
			return {
				id,
				name: 'whisper_status',
				success: false,
				error: `Cannot connect to Whisper server at ${this._baseUrl}. Is it running?`,
			};
		}
	}

	//#endregion
}
