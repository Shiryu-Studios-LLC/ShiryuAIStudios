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
import { IShiryuAiService, ShiryuProviderKind } from '../common/shiryuAiService.js';
const $ = DOM.$;

export class ShiryuAiModelManagerView extends ViewPane {

	static readonly ID = 'workbench.view.shiryuAiModelManager';

	private _contentContainer!: HTMLElement;
	private _statusText!: HTMLElement;
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

	// Common
	private _unloadButton!: HTMLElement;
	private _modelInfoContainer!: HTMLElement;
	private readonly _disposables = new DisposableStore();

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
		@ILogService private readonly _logService: ILogService,
	) {
		super(options, keybindingService, contextMenuService, _configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, hoverService);

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

		// Status Section
		const statusSection = DOM.append(this._contentContainer, $('.shiryu-ai-status-section'));
		statusSection.style.display = 'flex';
		statusSection.style.flexDirection = 'column';
		statusSection.style.gap = '8px';

		const statusHeader = DOM.append(statusSection, $('h3'));
		statusHeader.textContent = localize('status', 'Model Status');
		statusHeader.style.margin = '0 0 4px 0';
		statusHeader.style.fontSize = '13px';
		statusHeader.style.fontWeight = 'bold';

		this._statusText = DOM.append(statusSection, $('.shiryu-ai-status-text'));
		this._statusText.style.fontSize = '13px';
		this._statusText.style.color = 'var(--vscode-descriptionForeground)';

		// Provider Selection
		const providerSection = DOM.append(this._contentContainer, $('.shiryu-ai-provider-section'));
		providerSection.style.display = 'flex';
		providerSection.style.flexDirection = 'column';
		providerSection.style.gap = '6px';

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

		// Provider options
		const llamaOpt = document.createElement('option');
		llamaOpt.value = ShiryuProviderKind.LlamaCpp;
		llamaOpt.textContent = 'llama.cpp (Local GGUF)';
		this._providerSelect.appendChild(llamaOpt);

		const ollamaOpt = document.createElement('option');
		ollamaOpt.value = ShiryuProviderKind.Ollama;
		ollamaOpt.textContent = 'Ollama (Model Manager)';
		this._providerSelect.appendChild(ollamaOpt);

		// Set current provider
		this._providerSelect.value = this._shiryuAiService.activeProvider;

		this._disposables.add(DOM.addDisposableListener(this._providerSelect, DOM.EventType.CHANGE, () => {
			this._switchProvider(this._providerSelect.value as ShiryuProviderKind);
		}));

		// llama.cpp Section
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

		// Ollama Section
		this._ollamaSection = DOM.append(this._contentContainer, $('.shiryu-ai-ollama-section'));
		this._ollamaSection.style.display = 'none';
		this._ollamaSection.style.flexDirection = 'column';
		this._ollamaSection.style.gap = '8px';

		this._ollamaStatusText = DOM.append(this._ollamaSection, $('.shiryu-ai-ollama-status'));
		this._ollamaStatusText.style.fontSize = '12px';
		this._ollamaStatusText.style.color = 'var(--vscode-descriptionForeground)';
		this._ollamaStatusText.style.marginBottom = '4px';

		// Ollama model selector
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

		// Ollama pull section
		const pullLabel = DOM.append(this._ollamaSection, $('label'));
		pullLabel.textContent = localize('pullModel', 'Download New Model');
		pullLabel.style.fontSize = '12px';
		pullLabel.style.fontWeight = 'bold';

		const pullRow = DOM.append(this._ollamaSection, $('.shiryu-ai-ollama-pull-row'));
		pullRow.style.display = 'flex';
		pullRow.style.gap = '6px';

		this._ollamaPullInput = DOM.append(pullRow, $('input.shiryu-ai-ollama-pull-input')) as HTMLInputElement;
		this._ollamaPullInput.type = 'text';
		this._ollamaPullInput.placeholder = localize('pullModelPlaceholder', 'e.g. llama3.2, codellama:7b, qwen2.5-coder:7b');
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

		// Common: Unload button
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

		// Model Info Section
		this._modelInfoContainer = DOM.append(this._contentContainer, $('.shiryu-ai-info-section'));
		this._modelInfoContainer.style.display = 'flex';
		this._modelInfoContainer.style.flexDirection = 'column';

		// Wire up events
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

		this._refreshProviderVisibility();
		this._refreshStatus();
		this._refreshModelInfo();

		// If Ollama provider, refresh model list
		if (this._shiryuAiService.activeProvider === ShiryuProviderKind.Ollama) {
			this._refreshOllamaModels();
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}

	private _refreshProviderVisibility(): void {
		const isOllama = this._providerSelect?.value === ShiryuProviderKind.Ollama;
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

	private async _refreshOllamaModels(): Promise<void> {
		if (!this._ollamaModelSelect) {
			return;
		}

		// Clear existing options
		while (this._ollamaModelSelect.options.length > 1) {
			this._ollamaModelSelect.remove(1);
		}

		if (this._ollamaStatusText) {
			this._ollamaStatusText.textContent = localize('ollamaChecking', 'Checking Ollama connection...');
			this._ollamaStatusText.style.color = 'var(--vscode-descriptionForeground)';
		}

		try {
			const models = await this._shiryuAiService.listModels();

			if (models.length === 0) {
				if (this._ollamaStatusText) {
					this._ollamaStatusText.textContent = localize('ollamaNoModels', 'No models found. Download one below or run "ollama pull <model>" in terminal.');
					this._ollamaStatusText.style.color = 'var(--vscode-warningForeground)';
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
		} catch (err) {
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaError', 'Cannot connect to Ollama. Is it running?');
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		}
	}

	private async _pullOllamaModel(): Promise<void> {
		const modelName = this._ollamaPullInput?.value.trim();
		if (!modelName) {
			return;
		}

		if (this._ollamaStatusText) {
			this._ollamaStatusText.textContent = localize('ollamaPulling', 'Downloading {0}...', modelName);
			this._ollamaStatusText.style.color = 'var(--vscode-charts-yellow)';
		}

		if (this._ollamaPullButton) {
			(this._ollamaPullButton as HTMLElement).textContent = localize('downloading', 'Downloading...');
			(this._ollamaPullButton as HTMLElement).style.opacity = '0.5';
			(this._ollamaPullButton as HTMLElement).style.pointerEvents = 'none';
		}

		try {
			// Access the Ollama provider through the service
			// We need to use a method on the service to pull models
			// For now, we'll use a simple approach
			await this._ollamaPullDirect(modelName);

			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaPullComplete', 'Downloaded: {0}', modelName);
				this._ollamaStatusText.style.color = 'var(--vscode-charts-green)';
			}

			// Refresh the model list
			await this._refreshOllamaModels();
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaPullFailed', 'Download failed: {0}', errorMsg);
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		} finally {
			if (this._ollamaPullButton) {
				(this._ollamaPullButton as HTMLElement).textContent = localize('download', 'Download');
				(this._ollamaPullButton as HTMLElement).style.opacity = '1';
				(this._ollamaPullButton as HTMLElement).style.pointerEvents = 'auto';
			}
		}
	}

	private async _ollamaPullDirect(modelName: string): Promise<void> {
		// Direct Ollama API call for pull
		const baseUrl = 'http://localhost:11434';
		const response = await fetch(`${baseUrl}/api/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: modelName }),
		});

		if (!response.ok) {
			throw new Error(`Ollama pull failed: ${response.status} ${response.statusText}`);
		}

		// Read the streaming response
		const reader = response.body?.getReader();
		if (reader) {
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				const chunk = decoder.decode(value, { stream: true });
				for (const line of chunk.split('\n')) {
					if (line.trim()) {
						try {
							const progress = JSON.parse(line);
							if (progress.status && this._ollamaStatusText) {
								this._ollamaStatusText.textContent = progress.status;
							}
						} catch {
							// ignore
						}
					}
				}
			}
		}
	}

	private async _loadOllamaModel(): Promise<void> {
		const selected = this._ollamaModelSelect?.value;
		if (!selected) {
			this._logService.warn('[ShiryuAI] No Ollama model selected');
			return;
		}

		this._logService.info(`[ShiryuAI] Loading Ollama model: ${selected}`);

		try {
			await this._shiryuAiService.loadModel({
				modelPath: selected,
			});

			this._refreshStatus();
			this._refreshModelInfo();
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI] Failed to load Ollama model: ${errorMsg}`);
			if (this._ollamaStatusText) {
				this._ollamaStatusText.textContent = localize('ollamaLoadFailed', 'Load failed: {0}', errorMsg);
				this._ollamaStatusText.style.color = 'var(--vscode-errorForeground)';
			}
		}
	}

	private _refreshStatus(): void {
		if (!this._statusText) {
			return;
		}

		const isAvailable = this._shiryuAiService.isAvailable;
		const isBusy = this._shiryuAiService.isBusy;
		const provider = this._shiryuAiService.activeProvider;

		const providerName = provider === ShiryuProviderKind.Ollama ? 'Ollama' : 'llama.cpp';

		if (isBusy) {
			this._statusText.textContent = localize('generating', '{0} — Generating response...', providerName);
			this._statusText.style.color = 'var(--vscode-charts-yellow)';
		} else if (isAvailable) {
			const info = this._shiryuAiService.getModelInfo();
			const modelName = info?.modelPath || 'unknown';
			this._statusText.textContent = localize('loadedWithProvider', '{0} — {1} loaded', providerName, modelName);
			this._statusText.style.color = 'var(--vscode-charts-green)';
		} else {
			this._statusText.textContent = localize('notLoadedWithProvider', '{0} — No model loaded', providerName);
			this._statusText.style.color = 'var(--vscode-descriptionForeground)';
		}

		if (this._unloadButton) {
			(this._unloadButton as HTMLElement).style.opacity = isAvailable ? '1' : '0.5';
			(this._unloadButton as HTMLElement).style.pointerEvents = isAvailable ? 'auto' : 'none';
		}
	}

	private _refreshModelInfo(): void {
		if (!this._modelInfoContainer) {
			return;
		}

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
			contextLine.textContent = `${localize('contextSize', 'Context Size')}: ${info.contextSize.toLocaleString()} tokens`;
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
			if (this._modelPathInput) {
				this._modelPathInput.value = modelPath;
			}
			this._configurationService.updateValue('shiryuAi.modelPath', modelPath);
		}
	}

	private async _loadModel(): Promise<void> {
		const modelPath = this._modelPathInput?.value.trim();
		if (!modelPath) {
			this._logService.warn('[ShiryuAI] No model path specified');
			return;
		}

		this._logService.info(`[ShiryuAI] Loading model from: ${modelPath}`);

		try {
			await this._shiryuAiService.loadModel({
				modelPath,
				contextSize: this._configurationService.getValue<number>('shiryuAi.contextSize') ?? 4096,
				gpuLayers: this._configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
				temperature: this._configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
				maxTokens: this._configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
			});

			this._refreshStatus();
			this._refreshModelInfo();
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI] Failed to load model: ${errorMsg}`);
		}
	}

	private async _unloadModel(): Promise<void> {
		this._logService.info('[ShiryuAI] Unloading model...');
		await this._shiryuAiService.unloadModel();
		this._refreshStatus();
		this._refreshModelInfo();
	}
}
