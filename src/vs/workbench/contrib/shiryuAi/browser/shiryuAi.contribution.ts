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
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { HuggingFaceProvider } from '../common/shiryuAiHuggingFace.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

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
		{ name: 'model-info', description: 'Show information about the currently loaded model' },
	],
	disambiguation: [
		{ category: 'local-ai', description: 'Local AI inference using llama.cpp', examples: ['write a function', 'fix this bug', 'explain this code'] },
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

class ShiryuAiAgent implements IChatAgentImplementation {

	constructor(
		private readonly shiryuAiService: IShiryuAiService,
		private readonly configurationService: IConfigurationService,
	) { }

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		history: IChatAgentHistoryEntry[],
		token: CancellationToken
	): Promise<IChatAgentResult> {
		const modelPath = this.configurationService.getValue<string>('shiryuAi.modelPath');

		if (!this.shiryuAiService.isAvailable && modelPath) {
			progress([{ kind: 'markdownContent', content: new MarkdownString(`Loading model...`) }]);
			try {
				await this.shiryuAiService.loadModel({
					modelPath,
					contextSize: this.configurationService.getValue<number>('shiryuAi.contextSize') ?? 4096,
					gpuLayers: this.configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
					temperature: this.configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
					maxTokens: this.configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
				});
				progress([{ kind: 'markdownContent', content: new MarkdownString('**Model loaded.** Ask away!') }]);
			} catch (err) {
				return { errorDetails: { message: err instanceof Error ? err.message : String(err) } };
			}
		}

		if (!this.shiryuAiService.isAvailable) {
			const help = modelPath
				? '**Model failed to load.** Check the path in Settings → Shiryu AI → Model Path.'
				: '**No model configured.** Use `Ctrl+Shift+P` → **Shiryu AI: Download Models** to download, then **Shiryu AI: Scan Models** to select one.';
			progress([{ kind: 'markdownContent', content: new MarkdownString(help) }]);
			return {};
		}

		if (this.shiryuAiService.isBusy) {
			progress([{ kind: 'markdownContent', content: new MarkdownString('Model is busy. Please wait.') }]);
			return { errorDetails: { message: 'Model busy' } };
		}

		const prompt = this._buildPrompt(request.message, history);
		try {
			const result = await this.shiryuAiService.sendPrompt(prompt,
				(chunk) => progress([{ kind: 'markdownContent', content: new MarkdownString(chunk) }]),
				token);
			return { metadata: { tokenCount: result.tokenCount } };
		} catch (err) {
			return { errorDetails: { message: err instanceof Error ? err.message : String(err) } };
		}
	}

	provideFollowups(): Promise<IChatFollowup[]> { return Promise.resolve([]); }

	private _buildPrompt(message: string, history: IChatAgentHistoryEntry[]): string {
		const p: string[] = [];
		if (history.length) {
			p.push('Previous:');
			for (const e of history.slice(-5)) {
				p.push(`User: ${e.request.message}`);
				for (const r of e.response) { if (r.kind === 'markdownContent') { p.push(`Assistant: ${(r as IChatMarkdownContent).content.value}`); } }
			}
			p.push('');
		}
		p.push(`User: ${message}`);
		p.push('Assistant:');
		return p.join('\n');
	}
}

//#endregion

//#region Contribution

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
		this.logService.info('[ShiryuAI] Initializing...');
		const agent = new ShiryuAiAgent(this.shiryuAiService, this.configurationService);
		this._disposables.add(this.chatAgentService.registerDynamicAgent(shiryuAiAgentData, agent));
		this._syncCopilot();
		this._disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('shiryuAi.enableCopilot')) { this._syncCopilot(); }
		}));
	}

	private _syncCopilot(): void {
		const enabled = this.configurationService.getValue<boolean>('shiryuAi.enableCopilot') === true;
		const disabled = this.configurationService.getValue<boolean>(ChatConfiguration.AIDisabled) === true;
		if (enabled && disabled) { this.configurationService.updateValue(ChatConfiguration.AIDisabled, false); }
		else if (!enabled && !disabled) { this.configurationService.updateValue(ChatConfiguration.AIDisabled, true); }
	}

	override dispose(): void { this._disposables.dispose(); super.dispose(); }
}

registerWorkbenchContribution2(ShiryuAiContribution.ID, ShiryuAiContribution, WorkbenchPhase.BlockRestore);

//#endregion

//#region Commands

function formatSize(bytes: number): string {
	if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(0)} KB`; }
	if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

CommandsRegistry.registerCommand({
	id: 'shiryuAi.downloadModels',
	handler: async (accessor: ServicesAccessor) => {
		const logService = accessor.get(ILogService);
		const fileService = accessor.get(IFileService);
		const pathService = accessor.get(IPathService);
		const configService = accessor.get(IConfigurationService);
		const quickInput = accessor.get(IQuickInputService);

		const dirConfigured = configService.getValue<string>('shiryuAi.downloadDir');
		let downloadDir: string;
		if (dirConfigured) {
			downloadDir = dirConfigured;
		} else {
			const home = await pathService.userHome();
			downloadDir = `${home.fsPath}\\.shiryu-ai-studio\\models`;
		}

		const hfToken = configService.getValue<string>('shiryuAi.huggingFaceToken') || undefined;
		const hf = new HuggingFaceProvider(logService, fileService);

		const popular = hf.getPopularModels();
		const items = popular.map(m => ({ label: m }));

		const repoPick = await quickInput.pick(items, {
			placeHolder: 'Select a model to download from Hugging Face',
			title: 'Download AI Models',
		});

		if (!repoPick) { return; }

		try {
			const detail = await hf.getModelFiles(repoPick.label, hfToken);
			if (detail.fileCount === 0) {
				return;
			}

			const files = detail.ggufFiles
				.sort((a, b) => a.size - b.size)
				.map(f => ({ label: f.filename, description: hf.formatSize(f.size) }));

			const filePick = await quickInput.pick(files, {
				placeHolder: 'Select the GGUF file to download',
				title: `${repoPick.label} — ${detail.fileCount} files`,
			});

			if (!filePick) { return; }

			const dest = `${downloadDir}\\${filePick.label}`;
			await hf.downloadFile(repoPick.label, filePick.label, dest);
			configService.updateValue('shiryuAi.modelPath', dest);
			logService.info(`[ShiryuAI] Downloaded: ${dest}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logService.error(`[ShiryuAI] Download failed: ${msg}`);
		}
	},
});

CommandsRegistry.registerCommand({
	id: 'shiryuAi.scanModels',
	handler: async (accessor: ServicesAccessor) => {
		const fileService = accessor.get(IFileService);
		const pathService = accessor.get(IPathService);
		const configService = accessor.get(IConfigurationService);
		const quickInput = accessor.get(IQuickInputService);

		const dirConfigured = configService.getValue<string>('shiryuAi.downloadDir');
		let dir: string;
		if (dirConfigured) {
			dir = dirConfigured;
		} else {
			const home = await pathService.userHome();
			dir = `${home.fsPath}\\.shiryu-ai-studio\\models`;
		}

		try {
			const stat = await fileService.resolve(URI.file(dir));
			const models: Array<{ label: string; description: string; path: string }> = [];
			if (stat.children) {
				for (const child of stat.children) {
					if (child.name.endsWith('.gguf') && !child.name.startsWith('mmproj')) {
						const sz = child.size ?? 0;
						if (sz < 500_000_000) { continue; }
						models.push({ label: child.name.replace('.gguf', ''), description: formatSize(sz), path: child.resource.fsPath });
					}
				}
			}

			if (models.length === 0) {
				return;
			}

			const pick = await quickInput.pick(models, {
				placeHolder: 'Select a model to load',
				title: 'Available GGUF Models',
			});

			if (pick) {
				configService.updateValue('shiryuAi.modelPath', pick.path);
			}
		} catch {
			// directory not found
		}
	},
});

//#endregion

//#region Configuration

const configReg = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configReg.registerConfiguration({
	id: 'shiryuAi',
	title: 'Shiryu AI Studio',
	type: 'object',
	properties: {
		'shiryuAi.modelPath': {
			type: 'string', default: '',
			markdownDescription: 'Path to the GGUF model file.\n\n[Download Models](command:shiryuAi.downloadModels) — download GGUF files from Hugging Face.\n\n[Scan Models Directory](command:shiryuAi.scanModels) — pick from existing downloaded models.',
		},
		'shiryuAi.contextSize': { type: 'number', default: 4096, minimum: 512, maximum: 131072, description: 'Context window size in tokens.' },
		'shiryuAi.gpuLayers': { type: 'number', default: -1, minimum: -1, description: 'GPU layers to offload (-1 = all, 0 = CPU only).' },
		'shiryuAi.temperature': { type: 'number', default: 0.7, minimum: 0, maximum: 2, description: 'Sampling temperature.' },
		'shiryuAi.maxTokens': { type: 'number', default: 2048, minimum: 64, maximum: 32768, description: 'Max tokens per response.' },
		'shiryuAi.enableCopilot': { type: 'boolean', default: false, description: 'Re-enable GitHub Copilot as secondary AI.' },
		'shiryuAi.activeProvider': { type: 'string', default: 'llamaCpp', enum: ['llamaCpp', 'ollama'], description: 'AI inference provider.' },
		'shiryuAi.ollamaUrl': { type: 'string', default: 'http://localhost:11434', description: 'Ollama server URL.' },
		'shiryuAi.downloadDir': { type: 'string', default: '', description: 'Directory for downloaded GGUF models.' },
		'shiryuAi.huggingFaceToken': { type: 'string', default: '', description: 'Hugging Face API token (optional).' },
	},
});

//#endregion