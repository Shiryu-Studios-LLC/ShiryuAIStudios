/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IShiryuAiService, ShiryuProviderKind } from '../common/shiryuAiService.js';
import { HuggingFaceProvider } from '../common/shiryuAiHuggingFace.js';
const $ = DOM.$;

export class ShiryuAiModelManagerView extends ViewPane {

	static readonly ID = 'workbench.view.shiryuAiModelManager';

	private _contentContainer!: HTMLElement;
	private _statusText!: HTMLElement;

	// Provider selection
	private _providerSelect!: HTMLSelectElement;

	// llama.cpp section
	private _llamaCppSection!: HTMLElement;
	private _modelPathInput!: HTMLInputElement;
	private _loadButton!: HTMLElement;
	private _browseButton!: HTMLElement;

	// Ollama section
	private _ollamaSection!: HTMLElement;
	private _ollamaModelSelect!: HTMLSelectElement;
	private _ollamaRefreshButton!: HTMLElement;
	private _ollamaPullInput!: HTMLInputElement;
	private _ollamaPullButton!: HTMLElement;
	private _ollamaStatusText!: HTMLElement;

	// Hugging Face section
	private _hfSection!: HTMLElement;
	private _hfSearchInput!: HTMLInputElement;
	private _hfSearchButton!: HTMLElement;
	private _hfModelList!: HTMLElement;
	private _hfStatusText!: HTMLElement;
	private _hfAbortController: AbortController | undefined;

	// Common
	private _unloadButton!: HTMLElement;
	private _modelInfoContainer!: HTMLElement;
	private readonly _disposables = new DisposableStore();

	private readonly _hfProvider: HuggingFaceProvider;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IShiryuAiService private readonly _shiryuAiService: IShiryuAiService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@IPathService private readonly _pathService: IPathService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(options, keybindingService, contextMenuService, _configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, hoverService);

		this._hfProvider = new HuggingFaceProvider(this._logService, this._fileService);
		this._disposables.add(this._hfProvider);

		this._disposables.add(this._shiryuAiService.onDidChangeAvailability(() => {
			this._refreshStatus();
			this._refreshModelInfo();
		}));

		this._disposables.add(this._shiryuAiService.onDidChangeBusy(() => {
			this._refreshStatus();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._contentContainer = DOM.append(container, $('.shiryu-ai-model-manager-content'));
		this._contentContainer.style.display = 'flex';
		this._contentContainer.style.flexDirection = 'column';
		this._contentContainer.style.padding = '12px';
		this._contentContainer.style.gap = '12px';

		// ── Status ──
		const statusSection = DOM.append(this._contentContainer, $('.shiryu-ai-status-section'));
		statusSection.style.display = 'flex';
		statusSection.style.flexDirection = 'column';
		statusSection.style.gap = '4px';

		const statusHeader = DOM.append(statusSection, $('h3'));
		statusHeader.textContent = localize('status', 'Model Status');
		statusHeader.style.margin = '0';
		statusHeader.style.fontSize = '13px';
		statusHeader.style.fontWeight = 'bold';

		this._statusText = DOM.append(statusSection, $('.shiryu-ai-status-text'));
		this._statusText.style.fontSize = '13px';
		this._statusText.style.color = 'var(--vscode-descriptionForeground)';

		// ── Provider Selection ──
		const providerSection = DOM.append(this._contentContainer, $('.shiryu-ai-provider-section'));
		providerSection.style.display = 'flex';
		providerSection.style.flexDirection = 'column';
		providerSection.style.gap = '4px';

		const providerLabel = DOM.append(providerSection, $('label'));
		providerLabel.textContent = localize('provider', 'AI Provider');
		providerLabel.style.fontSize = '12px';
		providerLabel.style.fontWeight = 'bold';

		this._providerSelect = DOM.append(providerSection, $('select.shiryu-ai-provider-select')) as HTMLSelectElement;
		this._providerSelect.style.width = '100%';
		this._providerSelect.style.padding = '4px 8px';
		this._providerSelect.style.fontSize = '12px';
		this._providerSelect.style.background = 'var(--vscode-input-background)';
		this._providerSelect.style.color = 'var(--vscode-input-foreground)';
		this._providerSelect.style.border = '1px solid var(--vscode-input-border)';
		this._providerSelect.style.borderRadius = '2px';

		const llamaOpt = document.createElement('option');
		llamaOpt.value = ShiryuProviderKind.LlamaCpp;
		llamaOpt.textContent = 'llama.cpp (Local GGUF)';
		this._providerSelect.appendChild(llamaOpt);

		const ollamaOpt = document.createElement('option');
		ollamaOpt.value = ShiryuProviderKind.Ollama;
		ollamaOpt.textContent = 'Ollama (Model Manager)';
		this._providerSelect.appendChild(ollamaOpt);

		this._providerSelect.value = this._shiryuAiService.activeProvider;
		this._disposables.add(DOM.addDisposableListener(this._providerSelect, DOM.EventType.CHANGE, () => {
			this._switchProvider(this._providerSelect.value as ShiryuProviderKind);
		}));

		// ── llama.cpp Section ──
		this._llamaCppSection = DOM.append(this._contentContainer, $('.shiryu-ai-llamacpp-section'));
		this._llamaCppSection.style.display = 'flex';
		this._llamaCppSection.style.flexDirection = 'column';
		this._llamaCppSection.style.gap = '6px';

		const pathLabel = DOM.append(this._llamaCppSection, $('label'));
		pathLabel.textContent = localize('modelPath', 'GGUF Model File');
		pathLabel.style.fontSize = '12px';
		pathLabel.style.fontWeight = 'bold';

		const inputRow = DOM.append(this._llamaCppSection, $('.shiryu-ai-input-row'));
		inputRow.style.display = 'flex';
		inputRow.style.gap = '6px';

		this._modelPathInput = DOM.append(inputRow, $('input.shiryu-ai-model-path-input')) as HTMLInputElement;
		this._modelPathInput.type = 'text';
		this._modelPathInput.placeholder = localize('modelPathPlaceholder', 'Path to .gguf model file...');
		this._modelPathInput.style.flex = '1';
		this._modelPathInput.style.padding = '4px 8px';
		this._modelPathInput.style.fontSize = '12px';
		this._modelPathInput.style.background = 'var(--vscode-input-background)';
		this._modelPathInput.style.color = 'var(--vscode-input-foreground)';
		this._modelPathInput.style.border = '1px solid var(--vscode-input-border)';
		this._modelPathInput.style.borderRadius = '2px';
		this._modelPathInput.style.outline = 'none';

		const configPath = this._configurationService.getValue<string>('shiryuAi.modelPath');
		if (configPath) {
			this._modelPathInput.value = configPath;
		}

		this._browseButton = DOM.append(inputRow, $('button.shiryu-ai-browse-button'));
		this._browseButton.textContent = localize('browse', 'Browse');
		this._browseButton.style.padding = '4px 12px';
		this._browseButton.style.fontSize = '12px';
		this._browseButton.style.cursor = 'pointer';
		this._browseButton.style.background = 'var(--vscode-button-secondaryBackground)';
		this._browseButton.style.color = 'var(--vscode-button-secondaryForeground)';
		this._browseButton.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._browseButton.style.borderRadius = '2px';

		this._loadButton = DOM.append(this._llamaCppSection, $('button.shiryu-ai-load-button'));
		this._loadButton.textContent = localize('loadModel', 'Load Model');
		this._loadButton.style.padding = '6px 16px';
		this._loadButton.style.fontSize = '13px';
		this._loadButton.style.cursor = 'pointer';
		this._loadButton.style.background = 'var(--vscode-button-background)';
		this._loadButton.style.color = 'var(--vscode-button-foreground)';
		this._loadButton.style.border = 'none';
		this._loadButton.style.borderRadius = '2px';
		this._loadButton.style.fontWeight = 'bold';

		// ── Recent Models ──
		const recentSection = DOM.append(this._llamaCppSection, $('.shiryu-ai-recent-section'));
		recentSection.style.display = 'flex';
		recentSection.style.flexDirection = 'column';
		recentSection.style.gap = '4px';

		const recentLabel = DOM.append(recentSection, $('label'));
		recentLabel.textContent = localize('recentModels', 'Recent Models');
		recentLabel.style.fontSize = '11px';
		recentLabel.style.color = 'var(--vscode-descriptionForeground)';
		recentLabel.style.marginTop = '4px';

		const recentList = DOM.append(recentSection, $('.shiryu-ai-recent-list'));
		recentList.style.display = 'flex';
		recentList.style.flexDirection = 'column';
		recentList.style.gap = '2px';

		this._refreshRecentModels(recentList);

		// ── Ollama Section ──
		this._ollamaSection = DOM.append(this._contentContainer, $('.shiryu-ai-ollama-section'));
		this._ollamaSection.style.display = 'none';
		this._ollamaSection.style.flexDirection = 'column';
		this._ollamaSection.style.gap = '8px';

		this._ollamaStatusText = DOM.append(this._ollamaSection, $('.shiryu-ai-ollama-status'));
		this._ollamaStatusText.style.fontSize = '12px';
		this._ollamaStatusText.style.color = 'var(--vscode-descriptionForeground)';
		this._ollamaStatusText.style.marginBottom = '4px';

		const ollamaModelRow = DOM.append(this._ollamaSection, $('.shiryu-ai-ollama-model-row'));
		ollamaModelRow.style.display = 'flex';
		ollamaModelRow.style.gap = '6px';

		this._ollamaModelSelect = DOM.append(ollamaModelRow, $('select.shiryu-ai-ollama-model-select')) as HTMLSelectElement;
		this._ollamaModelSelect.style.flex = '1';
		this._ollamaModelSelect.style.padding = '4px 8px';
		this._ollamaModelSelect.style.fontSize = '12px';
		this._ollamaModelSelect.style.background = 'var(--vscode-input-background)';
		this._ollamaModelSelect.style.color = 'var(--vscode-input-foreground)';
		this._ollamaModelSelect.style.border = '1px solid var(--vscode-input-border)';
		this._ollamaModelSelect.style.borderRadius = '2px';

		const defaultOpt = document.createElement('option');
		defaultOpt.value = '';
		defaultOpt.textContent = localize('selectOllamaModel', 'Select a model...');
		this._ollamaModelSelect.appendChild(defaultOpt);

		this._ollamaRefreshButton = DOM.append(ollamaModelRow, $('button.shiryu-ai-ollama-refresh'));
		this._ollamaRefreshButton.textContent = localize('refresh', 'Refresh');
		this._ollamaRefreshButton.style.padding = '4px 8px';
		this._ollamaRefreshButton.style.fontSize = '11px';
		this._ollamaRefreshButton.style.cursor = 'pointer';
		this._ollamaRefreshButton.style.background = 'var(--vscode-button-secondaryBackground)';
		this._ollamaRefreshButton.style.color = 'var(--vscode-button-secondaryForeground)';
		this._ollamaRefreshButton.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._ollamaRefreshButton.style.borderRadius = '2px';

		const pullLabel = DOM.append(this._ollamaSection, $('label'));
		pullLabel.textContent = localize('pullModel', 'Download New Model');
		pullLabel.style.fontSize = '12px';
		pullLabel.style.fontWeight = 'bold';

		const pullRow = DOM.append(this._ollamaSection, $('.shiryu-ai-ollama-pull-row'));
		pullRow.style.display = 'flex';
		pullRow.style.gap = '6px';

		this._ollamaPullInput = DOM.append(pullRow, $('input.shiryu-ai-ollama-pull-input')) as HTMLInputElement;
		this._ollamaPullInput.type = 'text';
		this._ollamaPullInput.placeholder = localize('pullModelPlaceholder', 'e.g. llama3.2, codellama:7b');
		this._ollamaPullInput.style.flex = '1';
		this._ollamaPullInput.style.padding = '4px 8px';
		this._ollamaPullInput.style.fontSize = '12px';
		this._ollamaPullInput.style.background = 'var(--vscode-input-background)';
		this._ollamaPullInput.style.color = 'var(--vscode-input-foreground)';
		this._ollamaPullInput.style.border = '1px solid var(--vscode-input-border)';
		this._ollamaPullInput.style.borderRadius = '2px';
		this._ollamaPullInput.style.outline = 'none';

		this._ollamaPullButton = DOM.append(pullRow, $('button.shiryu-ai-ollama-pull-button'));
		this._ollamaPullButton.textContent = localize('download', 'Download');
		this._ollamaPullButton.style.padding = '4px 12px';
		this._ollamaPullButton.style.fontSize = '12px';
		this._ollamaPullButton.style.cursor = 'pointer';
		this._ollamaPullButton.style.background = 'var(--vscode-button-background)';
		this._ollamaPullButton.style.color = 'var(--vscode-button-foreground)';
		this._ollamaPullButton.style.border = 'none';
		this._ollamaPullButton.style.borderRadius = '2px';

		const ollamaLoadButton = DOM.append(this._ollamaSection, $('button.shiryu-ai-ollama-load-button'));
		ollamaLoadButton.textContent = localize('loadModel', 'Load Model');
		ollamaLoadButton.style.padding = '6px 16px';
		ollamaLoadButton.style.fontSize = '13px';
		ollamaLoadButton.style.cursor = 'pointer';
		ollamaLoadButton.style.background = 'var(--vscode-button-background)';
		ollamaLoadButton.style.color = 'var(--vscode-button-foreground)';
		ollamaLoadButton.style.border = 'none';
		ollamaLoadButton.style.borderRadius = '2px';
		ollamaLoadButton.style.fontWeight = 'bold';

		// ── Hugging Face Section ──
		this._hfSection = DOM.append(this._contentContainer, $('.shiryu-ai-hf-section'));
		this._hfSection.style.display = 'flex';
		this._hfSection.style.flexDirection = 'column';
		this._hfSection.style.gap = '8px';
		this._hfSection.style.borderTop = '1px solid var(--vscode-widget-border)';
		this._hfSection.style.paddingTop = '12px';

		const hfHeader = DOM.append(this._hfSection, $('h3'));
		hfHeader.textContent = localize('hfTitle', 'Download GGUF Models');
		hfHeader.style.margin = '0';
		hfHeader.style.fontSize = '13px';
		hfHeader.style.fontWeight = 'bold';

		const hfSubtitle = DOM.append(this._hfSection, $('div'));
		hfSubtitle.textContent = localize('hfSubtitle', 'Browse and download from Hugging Face');
		hfSubtitle.style.fontSize = '11px';
		hfSubtitle.style.color = 'var(--vscode-descriptionForeground)';
		hfSubtitle.style.marginTop = '-4px';

		// Search row
		const hfSearchRow = DOM.append(this._hfSection, $('.shiryu-ai-hf-search-row'));
		hfSearchRow.style.display = 'flex';
		hfSearchRow.style.gap = '6px';

		this._hfSearchInput = DOM.append(hfSearchRow, $('input.shiryu-ai-hf-search-input')) as HTMLInputElement;
		this._hfSearchInput.type = 'text';
		this._hfSearchInput.placeholder = localize('hfSearchPlaceholder', 'Search models (e.g. llama3, codellama, qwen2.5)...');
		this._hfSearchInput.style.flex = '1';
		this._hfSearchInput.style.padding = '4px 8px';
		this._hfSearchInput.style.fontSize = '12px';
		this._hfSearchInput.style.background = 'var(--vscode-input-background)';
		this._hfSearchInput.style.color = 'var(--vscode-input-foreground)';
		this._hfSearchInput.style.border = '1px solid var(--vscode-input-border)';
		this._hfSearchInput.style.borderRadius = '2px';
		this._hfSearchInput.style.outline = 'none';

		this._hfSearchButton = DOM.append(hfSearchRow, $('button.shiryu-ai-hf-search-button'));
		this._hfSearchButton.textContent = localize('search', 'Search');
		this._hfSearchButton.style.padding = '4px 12px';
		this._hfSearchButton.style.fontSize = '12px';
		this._hfSearchButton.style.cursor = 'pointer';
		this._hfSearchButton.style.background = 'var(--vscode-button-background)';
		this._hfSearchButton.style.color = 'var(--vscode-button-foreground)';
		this._hfSearchButton.style.border = 'none';
		this._hfSearchButton.style.borderRadius = '2px';

		this._hfStatusText = DOM.append(this._hfSection, $('.shiryu-ai-hf-status'));
		this._hfStatusText.style.fontSize = '11px';
		this._hfStatusText.style.color = 'var(--vscode-descriptionForeground)';

		// Model list container
		this._hfModelList = DOM.append(this._hfSection, $('.shiryu-ai-hf-model-list'));
		this._hfModelList.style.display = 'flex';
		this._hfModelList.style.flexDirection = 'column';
		this._hfModelList.style.gap = '4px';
		this._hfModelList.style.maxHeight = '300px';
		this._hfModelList.style.overflowY = 'auto';

		// ── Common: Unload + Info ──
		const unloadRow = DOM.append(this._contentContainer, $('.shiryu-ai-unload-row'));
		unloadRow.style.display = 'flex';

		this._unloadButton = DOM.append(unloadRow, $('button.shiryu-ai-unload-button'));
		this._unloadButton.textContent = localize('unloadModel', 'Unload Model');
		this._unloadButton.style.padding = '6px 16px';
		this._unloadButton.style.fontSize = '13px';
		this._unloadButton.style.cursor = 'pointer';
		this._unloadButton.style.background = 'var(--vscode-button-secondaryBackground)';
		this._unloadButton.style.color = 'var(--vscode-button-secondaryForeground)';
		this._unloadButton.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._unloadButton.style.borderRadius = '2px';

		this._modelInfoContainer = DOM.append(this._contentContainer, $('.shiryu-ai-info-section'));
		this._modelInfoContainer.style.display = 'flex';
		this._modelInfoContainer.style.flexDirection = 'column';

		// ── Wire events ──
		this._disposables.add(DOM.addDisposableListener(this._browseButton, DOM.EventType.CLICK, () => this._browseForModel()));
		this._disposables.add(DOM.addDisposableListener(this._loadButton, DOM.EventType.CLICK, () => this._loadModel()));
		this._disposables.add(DOM.addDisposableListener(this._unloadButton, DOM.EventType.CLICK, () => this._unloadModel()));
		this._disposables.add(DOM.addDisposableListener(this._modelPathInput, DOM.EventType.INPUT, () => {
			if (this._modelPathInput) {
				this._configurationService.updateValue('shiryuAi.modelPath', this._modelPathInput.value);
			}
		}));
		this._disposables.add(DOM.addDisposableListener(this._ollamaRefreshButton, DOM.EventType.CLICK, () => this._refreshOllamaModels()));
		this._disposables.add(DOM.addDisposableListener(this._ollamaPullButton, DOM.EventType.CLICK, () => this._pullOllamaModel()));
		this._disposables.add(DOM.addDisposableListener(this._ollamaModelSelect, DOM.EventType.CHANGE, () => {
			const selected = this._ollamaModelSelect.value;
			if (selected) {
				this._ollamaPullInput.value = selected;
			}
		}));
		this._disposables.add(DOM.addDisposableListener(ollamaLoadButton, DOM.EventType.CLICK, () => this._loadOllamaModel()));
		this._disposables.add(DOM.addDisposableListener(this._hfSearchButton, DOM.EventType.CLICK, () => this._searchHuggingFace()));
		this._disposables.add(DOM.addDisposableListener(this._hfSearchInput, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this._searchHuggingFace();
			}
		}));

		this._refreshProviderVisibility();
		this._refreshStatus();
		this._refreshModelInfo();

		// Load popular models on first render
		this._loadPopularModels();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	override dispose(): void {
		this._hfAbortController?.abort();
		this._disposables.dispose();
		super.dispose();
	}

	//#region Provider switching

	private _refreshProviderVisibility(): void {
		const provider = this._providerSelect?.value;
		const isOllama = provider === ShiryuProviderKind.Ollama;
		if (this._llamaCppSection) {
			this._llamaCppSection.style.display = isOllama ? 'none' : 'flex';
		}
		if (this._ollamaSection) {
			this._ollamaSection.style.display = isOllama ? 'flex' : 'none';
		}
	}

	private async _switchProvider(kind: ShiryuProviderKind): Promise<void> {
		this._logService.info(`[ShiryuAI] Switching to provider: ${kind}`);
		await this._shiryuAiService.switchProvider(kind);
		this._refreshProviderVisibility();
		this._refreshStatus();
		this._refreshModelInfo();
		if (kind === ShiryuProviderKind.Ollama) {
			this._refreshOllamaModels();
		}
	}

	//#endregion

	//#region Ollama

	private async _refreshOllamaModels(): Promise<void> {
		if (!this._ollamaModelSelect) {
			return;
		}
		while (this._ollamaModelSelect.options.length > 1) {
			this._ollamaModelSelect.remove(1);
		}
		if (this._ollamaStatusText) {
			this._ollamaStatusText.textContent = localize('ollamaChecking', 'Checking Ollama connection...');
		}
		try {
			const models = await this._shiryuAiService.listModels();
			if (models.length === 0) {
				if (this._ollamaStatusText) {
					this._ollamaStatusText.textContent = localize('ollamaNoModels', 'No models found. Download one below.');
				}
				return;
			}
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaModelsFound', '{0} model(s) available', models.length);
				this._ollamaStatusText.style.color = 'var(--vscode-charts-green)';
			}
			for (const model of models) {
				const opt = document.createElement('option');
				opt.value = model;
				opt.textContent = model;
				this._ollamaModelSelect.appendChild(opt);
			}
		} catch {
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaError', 'Cannot connect to Ollama. Is it running?');
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		}
	}

	private async _pullOllamaModel(): Promise<void> {
		const modelName = this._ollamaPullInput?.value.trim();
		if (!modelName) { return; }
		if (this._ollamaStatusText) {
			this._ollamaStatusText.textContent = localize('ollamaPulling', 'Downloading {0}...', modelName);
			this._ollamaStatusText.style.color = 'var(--vscode-charts-yellow)';
		}
		this._setButtonBusy(this._ollamaPullButton, true, localize('downloading', 'Downloading...'));
		try {
			const baseUrl = this._configurationService.getValue<string>('shiryuAi.ollamaUrl') || 'http://localhost:11434';
			const response = await fetch(`${baseUrl}/api/pull`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: modelName }),
			});
			if (!response.ok) { throw new Error(`Ollama pull failed: ${response.status}`); }
			const reader = response.body?.getReader();
			if (reader) {
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					const chunk = decoder.decode(value, { stream: true });
					for (const line of chunk.split('\n')) {
						if (line.trim()) {
							try {
								const p = JSON.parse(line);
								if (p.status && this._ollamaStatusText) { this._ollamaStatusText.textContent = p.status; }
							} catch { /* ignore */ }
						}
					}
				}
			}
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaPullDone', 'Downloaded: {0}', modelName);
				this._ollamaStatusText.style.color = 'var(--vscode-charts-green)';
			}
			await this._refreshOllamaModels();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaPullFailed', 'Failed: {0}', msg);
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		} finally {
			this._setButtonBusy(this._ollamaPullButton, false, localize('download', 'Download'));
		}
	}

	private async _loadOllamaModel(): Promise<void> {
		const selected = this._ollamaModelSelect?.value;
		if (!selected) { return; }
		try {
			await this._shiryuAiService.loadModel({ modelPath: selected });
			this._refreshStatus();
			this._refreshModelInfo();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI] Ollama load failed: ${msg}`);
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaLoadFailed', 'Load failed: {0}', msg);
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		}
	}

	//#endregion

	//#region Hugging Face

	private async _loadPopularModels(): Promise<void> {
		if (!this._hfModelList) { return; }
		DOM.clearNode(this._hfModelList);
		this._hfStatusText.textContent = localize('hfPopular', 'Popular GGUF models:');
		this._hfStatusText.style.color = 'var(--vscode-descriptionForeground)';

		const popular = this._hfProvider.getPopularModels();
		for (const modelId of popular) {
			this._appendModelRow(modelId, 0, 0);
		}
	}

	private async _searchHuggingFace(): Promise<void> {
		const query = this._hfSearchInput?.value.trim() || '';
		if (!this._hfModelList) { return; }

		DOM.clearNode(this._hfModelList);
		this._hfAbortController?.abort();
		this._hfAbortController = new AbortController();

		this._hfStatusText.textContent = localize('hfSearching', 'Searching Hugging Face...');
		this._hfStatusText.style.color = 'var(--vscode-descriptionForeground)';
		this._setButtonBusy(this._hfSearchButton, true, localize('searching', 'Searching...'));

		try {
			const models = await this._hfProvider.searchModels(query, 20);
			if (models.length === 0) {
				this._hfStatusText.textContent = localize('hfNoResults', 'No GGUF models found.');
				return;
			}
			this._hfStatusText.textContent = localize('hfResults', '{0} model(s) found', models.length);
			this._hfStatusText.style.color = 'var(--vscode-charts-green)';

			for (const model of models) {
				this._appendModelRow(model.id, model.downloads, model.likes);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._hfStatusText.textContent = localize('hfSearchFailed', 'Search failed: {0}', msg);
			this._hfStatusText.style.color = 'var(--vscode-errorForeground)';
		} finally {
			this._setButtonBusy(this._hfSearchButton, false, localize('search', 'Search'));
		}
	}

	private _appendModelRow(modelId: string, downloads: number, likes: number): void {
		const row = DOM.append(this._hfModelList, $('.shiryu-ai-hf-model-row'));
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '8px';
		row.style.padding = '6px 8px';
		row.style.borderRadius = '4px';
		row.style.background = 'var(--vscode-list-hoverBackground)';
		row.style.cursor = 'pointer';

		const info = DOM.append(row, $('.shiryu-ai-hf-model-info'));
		info.style.flex = '1';
		info.style.minWidth = '0';

		const name = DOM.append(info, $('div'));
		name.textContent = modelId;
		name.style.fontSize = '12px';
		name.style.fontWeight = 'bold';
		name.style.overflow = 'hidden';
		name.style.textOverflow = 'ellipsis';
		name.style.whiteSpace = 'nowrap';

		if (downloads > 0 || likes > 0) {
			const meta = DOM.append(info, $('div'));
			const parts: string[] = [];
			if (downloads > 0) {
				parts.push(`${downloads.toLocaleString()} downloads`);
			}
			if (likes > 0) {
				parts.push(`${likes} likes`);
			}
			meta.textContent = parts.join(' · ');
			meta.style.fontSize = '10px';
			meta.style.color = 'var(--vscode-descriptionForeground)';
		}

		const downloadBtn = DOM.append(row, $('button.shiryu-ai-hf-download-btn'));
		downloadBtn.textContent = localize('downloadGGUF', 'Download GGUF');
		downloadBtn.style.padding = '3px 10px';
		downloadBtn.style.fontSize = '11px';
		downloadBtn.style.cursor = 'pointer';
		downloadBtn.style.background = 'var(--vscode-button-background)';
		downloadBtn.style.color = 'var(--vscode-button-foreground)';
		downloadBtn.style.border = 'none';
		downloadBtn.style.borderRadius = '2px';
		downloadBtn.style.whiteSpace = 'nowrap';

		this._disposables.add(DOM.addDisposableListener(downloadBtn, DOM.EventType.CLICK, (e) => {
			e.stopPropagation();
			this._downloadModelFiles(modelId);
		}));

		this._disposables.add(DOM.addDisposableListener(row, DOM.EventType.CLICK, () => {
			this._showModelFiles(modelId);
		}));
	}

	private async _showModelFiles(modelId: string): Promise<void> {
		DOM.clearNode(this._hfModelList);
		this._hfStatusText.textContent = localize('hfLoadingFiles', 'Loading files for {0}...', modelId);
		this._hfStatusText.style.color = 'var(--vscode-descriptionForeground)';

		try {
			const hfToken = this._configurationService.getValue<string>('shiryuAi.huggingFaceToken') || undefined;
			const detail = await this._hfProvider.getModelFiles(modelId, hfToken);
			if (detail.fileCount === 0) {
				this._hfStatusText.textContent = localize('hfNoGGUF', 'No GGUF files found. This model may be gated — set your HF token in Settings.');
				this._hfStatusText.style.color = 'var(--vscode-warningForeground)';
				return;
			}

			this._hfStatusText.textContent = localize('hfFilesFound', '{0} GGUF file(s) — {1} total',
				detail.fileCount, this._hfProvider.formatSize(detail.totalSize));
			this._hfStatusText.style.color = 'var(--vscode-charts-green)';

			// Back button
			const backRow = DOM.append(this._hfModelList, $('.shiryu-ai-hf-back-row'));
			backRow.style.padding = '4px 8px';
			const backBtn = DOM.append(backRow, $('button'));
			backBtn.textContent = localize('back', '← Back to search');
			backBtn.style.fontSize = '11px';
			backBtn.style.cursor = 'pointer';
			backBtn.style.background = 'none';
			backBtn.style.border = 'none';
			backBtn.style.color = 'var(--vscode-textLink.foreground)';
			this._disposables.add(DOM.addDisposableListener(backBtn, DOM.EventType.CLICK, () => this._searchHuggingFace()));

			// Download directory
			const downloadDir = await this._getDownloadDir();

			for (const file of detail.ggufFiles) {
				const fileRow = DOM.append(this._hfModelList, $('.shiryu-ai-hf-file-row'));
				fileRow.style.display = 'flex';
				fileRow.style.alignItems = 'center';
				fileRow.style.gap = '8px';
				fileRow.style.padding = '6px 8px';
				fileRow.style.borderRadius = '4px';
				fileRow.style.background = 'var(--vscode-list-hoverBackground)';

				const fileInfo = DOM.append(fileRow, $('.shiryu-ai-hf-file-info'));
				fileInfo.style.flex = '1';
				fileInfo.style.minWidth = '0';

				const fileName = DOM.append(fileInfo, $('div'));
				fileName.textContent = file.filename;
				fileName.style.fontSize = '12px';
				fileName.style.fontWeight = 'bold';
				fileName.style.overflow = 'hidden';
				fileName.style.textOverflow = 'ellipsis';
				fileName.style.whiteSpace = 'nowrap';

				const fileSize = DOM.append(fileInfo, $('div'));
				fileSize.textContent = this._hfProvider.formatSize(file.size);
				fileSize.style.fontSize = '10px';
				fileSize.style.color = 'var(--vscode-descriptionForeground)';

					const destPath = `${downloadDir}\\${file.filename}`;

				// Check if file already exists
				let fileExists = false;
				try {
					const destUri = URI.file(destPath);
					fileExists = await this._fileService.exists(destUri);
				} catch {
					// ignore
				}

				if (fileExists) {
					// Show "Downloaded" label + Delete button
					const downloadedLabel = DOM.append(fileRow, $('span'));
					downloadedLabel.textContent = localize('downloaded', 'Downloaded');
					downloadedLabel.style.fontSize = '11px';
					downloadedLabel.style.color = 'var(--vscode-charts-green)';
					downloadedLabel.style.fontWeight = 'bold';

					const deleteBtn = DOM.append(fileRow, $('button.shiryu-ai-hf-file-delete'));
					deleteBtn.textContent = localize('delete', 'Delete');
					deleteBtn.style.padding = '3px 10px';
					deleteBtn.style.fontSize = '11px';
					deleteBtn.style.cursor = 'pointer';
					deleteBtn.style.background = 'var(--vscode-inputValidation-errorBackground)';
					deleteBtn.style.color = 'var(--vscode-errorForeground)';
					deleteBtn.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
					deleteBtn.style.borderRadius = '2px';
					deleteBtn.style.whiteSpace = 'nowrap';

					this._disposables.add(DOM.addDisposableListener(deleteBtn, DOM.EventType.CLICK, async () => {
						this._setButtonBusy(deleteBtn as HTMLElement, true, localize('deleting', 'Deleting...'));
						try {
							const destUri = URI.file(destPath);
							await this._fileService.del(destUri);
							this._hfStatusText.textContent = localize('hfDeleted', 'Deleted: {0}', file.filename);
							this._hfStatusText.style.color = 'var(--vscode-charts-green)';
							// Refresh the file list
							await this._showModelFiles(modelId);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							this._hfStatusText.textContent = localize('hfDeleteFailed', 'Delete failed: {0}', msg);
							this._hfStatusText.style.color = 'var(--vscode-errorForeground)';
						} finally {
							this._setButtonBusy(deleteBtn as HTMLElement, false, localize('delete', 'Delete'));
						}
					}));
				} else {
					// Show Download button
					const fileBtn = DOM.append(fileRow, $('button.shiryu-ai-hf-file-download'));
					fileBtn.textContent = localize('download', 'Download');
					fileBtn.style.padding = '3px 10px';
					fileBtn.style.fontSize = '11px';
					fileBtn.style.cursor = 'pointer';
					fileBtn.style.background = 'var(--vscode-button-background)';
					fileBtn.style.color = 'var(--vscode-button-foreground)';
					fileBtn.style.border = 'none';
					fileBtn.style.borderRadius = '2px';
					fileBtn.style.whiteSpace = 'nowrap';

					this._disposables.add(DOM.addDisposableListener(fileBtn, DOM.EventType.CLICK, async () => {
						this._setButtonBusy(fileBtn as HTMLElement, true, localize('downloading', 'Downloading...'));
						try {
							await this._hfProvider.downloadFile(modelId, file.path, destPath,
								(_bytes, total, percent) => {
									(fileBtn as HTMLElement).textContent = `${percent}%`;
									this._hfStatusText.textContent = localize('hfDownloading', 'Downloading {0}... {1}%', file.filename, percent);
								},
							this._hfAbortController?.signal,
							);
							(fileBtn as HTMLElement).textContent = localize('downloaded', 'Downloaded');
							(fileBtn as HTMLElement).style.color = 'var(--vscode-charts-green)';
							// Set the model path input
							if (this._modelPathInput) {
								this._modelPathInput.value = destPath;
							}
							this._configurationService.updateValue('shiryuAi.modelPath', destPath);
							this._hfStatusText.textContent = localize('hfDownloadComplete', 'Downloaded: {0}', destPath);
							this._hfStatusText.style.color = 'var(--vscode-charts-green)';
							// Refresh to show delete button
							await this._showModelFiles(modelId);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							(fileBtn as HTMLElement).textContent = localize('failed', 'Failed');
							(fileBtn as HTMLElement).style.color = 'var(--vscode-errorForeground)';
							this._hfStatusText.textContent = localize('hfDownloadFailed', 'Download failed: {0}', msg);
							this._hfStatusText.style.color = 'var(--vscode-errorForeground)';
						}
					}));
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._hfStatusText.textContent = localize('hfLoadFilesFailed', 'Failed to load files: {0}', msg);
			this._hfStatusText.style.color = 'var(--vscode-errorForeground)';
			// Show back button
			this._showBackButton();
		}
	}

	private async _downloadModelFiles(modelId: string): Promise<void> {
		DOM.clearNode(this._hfModelList);
		this._hfStatusText.textContent = localize('hfLoadingFiles', 'Loading files for {0}...', modelId);
		this._hfStatusText.style.color = 'var(--vscode-descriptionForeground)';

		try {
			const hfToken = this._configurationService.getValue<string>('shiryuAi.huggingFaceToken') || undefined;
			const detail = await this._hfProvider.getModelFiles(modelId, hfToken);
			if (detail.fileCount === 0) {
				this._hfStatusText.textContent = localize('hfNoGGUF', 'No GGUF files found. This model may be gated — set your HF token in Settings.');
				this._hfStatusText.style.color = 'var(--vscode-warningForeground)';
				return;
			}

			// Auto-download the first/smallest GGUF file
			const smallest = detail.ggufFiles.sort((a, b) => a.size - b.size)[0];
			const downloadDir = await this._getDownloadDir();
			const destPath = `${downloadDir}\\${smallest.filename}`;

			this._hfStatusText.textContent = localize('hfAutoDownloading', 'Downloading {0} ({1})...',
				smallest.filename, this._hfProvider.formatSize(smallest.size));
			this._hfStatusText.style.color = 'var(--vscode-charts-yellow)';

			await this._hfProvider.downloadFile(modelId, smallest.path, destPath,
				(_bytes, total, percent) => {
					this._hfStatusText.textContent = localize('hfDownloadingPercent', 'Downloading {0}... {1}%',
						smallest.filename, percent);
				},
				this._hfAbortController?.signal,
			);

			if (this._modelPathInput) {
				this._modelPathInput.value = destPath;
			}
			this._configurationService.updateValue('shiryuAi.modelPath', destPath);
			this._hfStatusText.textContent = localize('hfReady', 'Downloaded! Path set. Click "Load Model" to start.');
			this._hfStatusText.style.color = 'var(--vscode-charts-green)';
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._hfStatusText.textContent = localize('hfDownloadFailed', 'Download failed: {0}', msg);
			this._hfStatusText.style.color = 'var(--vscode-errorForeground)';
		}
	}

	private _showBackButton(): void {
		const backRow = DOM.append(this._hfModelList, $('.shiryu-ai-hf-back-row'));
		backRow.style.padding = '4px 8px';
		const backBtn = DOM.append(backRow, $('button'));
		backBtn.textContent = localize('back', '← Back to search');
		backBtn.style.fontSize = '11px';
		backBtn.style.cursor = 'pointer';
		backBtn.style.background = 'none';
		backBtn.style.border = 'none';
		backBtn.style.color = 'var(--vscode-textLink.foreground)';
		this._disposables.add(DOM.addDisposableListener(backBtn, DOM.EventType.CLICK, () => this._searchHuggingFace()));
	}

	private async _getDownloadDir(): Promise<string> {
		const configured = this._configurationService.getValue<string>('shiryuAi.downloadDir');
		if (configured) { return configured; }

		// Use VS Code's path service to resolve home directory
		const homeDir = await this._pathService.userHome();
		return `${homeDir.fsPath}\\.shiryu-ai-studio\\models`;
	}

	//#endregion

	//#region Common

	private _refreshStatus(): void {
		if (!this._statusText) { return; }
		const isAvailable = this._shiryuAiService.isAvailable;
		const isBusy = this._shiryuAiService.isBusy;
		const provider = this._shiryuAiService.activeProvider;
		const providerName = provider === ShiryuProviderKind.Ollama ? 'Ollama' : 'llama.cpp';

		if (isBusy) {
			this._statusText.textContent = localize('generating', '{0} — Generating...', providerName);
			this._statusText.style.color = 'var(--vscode-charts-yellow)';
		} else if (isAvailable) {
			const info = this._shiryuAiService.getModelInfo();
			this._statusText.textContent = localize('loaded', '{0} — {1} loaded', providerName, info?.modelPath || 'unknown');
			this._statusText.style.color = 'var(--vscode-charts-green)';
		} else {
			this._statusText.textContent = localize('notLoaded', '{0} — No model loaded', providerName);
			this._statusText.style.color = 'var(--vscode-descriptionForeground)';
		}

		if (this._unloadButton) {
			(this._unloadButton as HTMLElement).style.opacity = isAvailable ? '1' : '0.5';
			(this._unloadButton as HTMLElement).style.pointerEvents = isAvailable ? 'auto' : 'none';
		}
	}

	private _refreshModelInfo(): void {
		if (!this._modelInfoContainer) { return; }
		DOM.clearNode(this._modelInfoContainer);
		const info = this._shiryuAiService.getModelInfo();
		if (!info) {
			this._modelInfoContainer.style.display = 'none';
			return;
		}
		this._modelInfoContainer.style.display = 'flex';
		this._modelInfoContainer.style.flexDirection = 'column';
		this._modelInfoContainer.style.gap = '4px';
		this._modelInfoContainer.style.padding = '8px';
		this._modelInfoContainer.style.background = 'var(--vscode-textBlockQuote-background)';
		this._modelInfoContainer.style.borderRadius = '4px';

		const title = DOM.append(this._modelInfoContainer, $('strong'));
		title.textContent = localize('loadedModel', 'Loaded Model');
		title.style.fontSize = '12px';

		const providerLine = DOM.append(this._modelInfoContainer, $('div'));
		providerLine.textContent = `${localize('provider', 'Provider')}: ${info.provider === ShiryuProviderKind.Ollama ? 'Ollama' : 'llama.cpp'}`;
		providerLine.style.fontSize = '12px';
		providerLine.style.color = 'var(--vscode-descriptionForeground)';

		const pathLine = DOM.append(this._modelInfoContainer, $('div'));
		pathLine.textContent = `${localize('path', 'Model')}: ${info.modelPath}`;
		pathLine.style.fontSize = '12px';
		pathLine.style.wordBreak = 'break-all';
		pathLine.style.color = 'var(--vscode-descriptionForeground)';

		if (info.contextSize > 0) {
			const contextLine = DOM.append(this._modelInfoContainer, $('div'));
			contextLine.textContent = `${localize('contextSize', 'Context')}: ${info.contextSize.toLocaleString()} tokens`;
			contextLine.style.fontSize = '12px';
			contextLine.style.color = 'var(--vscode-descriptionForeground)';
		}
	}

	private async _browseForModel(): Promise<void> {
		const result = await this._fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: [
				{ name: localize('ggufFiles', 'GGUF Model Files'), extensions: ['gguf'] },
				{ name: localize('allFiles', 'All Files'), extensions: ['*'] },
			],
			title: localize('selectModel', 'Select GGUF Model'),
		});
		if (result && result.length > 0) {
			const modelPath = result[0].fsPath;
			if (this._modelPathInput) { this._modelPathInput.value = modelPath; }
			this._configurationService.updateValue('shiryuAi.modelPath', modelPath);
		}
	}

	private async _loadModel(): Promise<void> {
		const modelPath = this._modelPathInput?.value.trim();
		if (!modelPath) {
			this._statusText.textContent = localize('statusNoPath', 'No model path specified. Browse or download a model first.');
			this._statusText.style.color = 'var(--vscode-warningForeground)';
			return;
		}

		// Check if file exists
		try {
			const exists = await this._fileService.exists(URI.file(modelPath));
			if (!exists) {
				this._statusText.textContent = localize('statusFileMissing', 'File not found: {0}', modelPath);
				this._statusText.style.color = 'var(--vscode-errorForeground)';
				return;
			}
		} catch {
			// ignore
		}

		// Show loading state
		this._setButtonBusy(this._loadButton as HTMLElement, true, localize('loading', 'Loading...'));
		this._statusText.textContent = localize('statusLoading', 'llama.cpp — Loading model...');
		this._statusText.style.color = 'var(--vscode-charts-yellow)';

		if (this._modelInfoContainer) {
			this._modelInfoContainer.style.display = 'flex';
			DOM.clearNode(this._modelInfoContainer);
			const loadingText = DOM.append(this._modelInfoContainer, $('div'));
			loadingText.textContent = localize('loadingModel', 'Loading {0}...', modelPath.split('\\').pop() || modelPath);
			loadingText.style.fontSize = '12px';
			loadingText.style.color = 'var(--vscode-charts-yellow)';
			loadingText.style.fontStyle = 'italic';
		}

		try {
			await this._shiryuAiService.loadModel({
				modelPath,
				contextSize: this._configurationService.getValue<number>('shiryuAi.contextSize') ?? 4096,
				gpuLayers: this._configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
				temperature: this._configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
				maxTokens: this._configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
			});
			this._addRecentModel(modelPath);
			this._statusText.textContent = localize('statusLoaded', 'llama.cpp — Model loaded and ready');
			this._statusText.style.color = 'var(--vscode-charts-green)';
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI] Load failed: ${msg}`);
			this._statusText.textContent = localize('statusError', 'llama.cpp — Load failed: {0}', msg);
			this._statusText.style.color = 'var(--vscode-errorForeground)';
		} finally {
			this._setButtonBusy(this._loadButton as HTMLElement, false, localize('loadModel', 'Load Model'));
			this._refreshStatus();
			this._refreshModelInfo();
		}
	}

	private async _unloadModel(): Promise<void> {
		this._setButtonBusy(this._unloadButton as HTMLElement, true, localize('unloading', 'Unloading...'));
		try {
			await this._shiryuAiService.unloadModel();
			this._statusText.textContent = localize('statusUnloaded', 'llama.cpp — Model unloaded');
			this._statusText.style.color = 'var(--vscode-descriptionForeground)';
		} finally {
			this._setButtonBusy(this._unloadButton as HTMLElement, false, localize('unloadModel', 'Unload Model'));
			this._refreshStatus();
			this._refreshModelInfo();
		}
	}

	//#region Recent Models

	private _getRecentModels(): string[] {
		return this._configurationService.getValue<string[]>('shiryuAi.recentModels') || [];
	}

	private _addRecentModel(modelPath: string): void {
		let recent = this._getRecentModels();
		// Remove if already in list
		recent = recent.filter(p => p !== modelPath);
		// Add to front
		recent.unshift(modelPath);
		// Keep max 5
		if (recent.length > 5) {
			recent = recent.slice(0, 5);
		}
		this._configurationService.updateValue('shiryuAi.recentModels', recent);
	}

	private _refreshRecentModels(container: HTMLElement): void {
		if (!container) { return; }
		DOM.clearNode(container);

		const recent = this._getRecentModels();
		if (recent.length === 0) {
			const empty = DOM.append(container, $('div'));
			empty.textContent = localize('noRecent', 'No models loaded yet');
			empty.style.fontSize = '11px';
			empty.style.color = 'var(--vscode-disabledForeground)';
			empty.style.fontStyle = 'italic';
			return;
		}

		for (const modelPath of recent) {
			const fileName = modelPath.split('\\').pop() || modelPath.split('/').pop() || modelPath;
			const row = DOM.append(container, $('.shiryu-ai-recent-item'));
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '6px';
			row.style.padding = '3px 6px';
			row.style.borderRadius = '3px';
			row.style.cursor = 'pointer';
			row.style.fontSize = '11px';
			row.style.color = 'var(--vscode-textLink.foreground)';

			const icon = DOM.append(row, $('span'));
			icon.textContent = '$(file)';
			icon.style.fontSize = '11px';

			const name = DOM.append(row, $('span'));
			name.textContent = fileName;
			name.style.overflow = 'hidden';
			name.style.textOverflow = 'ellipsis';
			name.style.whiteSpace = 'nowrap';
			name.style.flex = '1';

			this._disposables.add(DOM.addDisposableListener(row, DOM.EventType.CLICK, () => {
				if (this._modelPathInput) {
					this._modelPathInput.value = modelPath;
				}
				this._configurationService.updateValue('shiryuAi.modelPath', modelPath);
				this._loadModel();
			}));

			this._disposables.add(DOM.addDisposableListener(row, DOM.EventType.MOUSE_ENTER, () => {
				row.style.background = 'var(--vscode-list-hoverBackground)';
			}));
			this._disposables.add(DOM.addDisposableListener(row, DOM.EventType.MOUSE_LEAVE, () => {
				row.style.background = 'transparent';
			}));
		}
	}

	//#endregion

	private _setButtonBusy(btn: HTMLElement, busy: boolean, text?: string): void {
		if (!btn) { return; }
		if (busy) {
			(btn as HTMLElement).style.opacity = '0.5';
			(btn as HTMLElement).style.pointerEvents = 'none';
			if (text) { (btn as HTMLElement).textContent = text; }
		} else {
			(btn as HTMLElement).style.opacity = '1';
			(btn as HTMLElement).style.pointerEvents = 'auto';
			if (text) { (btn as HTMLElement).textContent = text; }
		}
	}

	//#endregion
}
