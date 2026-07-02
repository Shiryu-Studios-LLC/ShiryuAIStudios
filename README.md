# Shiryu AI Studio

An AI-native code editor built on the VS Code foundation, powered by local llama.cpp inference.

## Features

- **Local AI Inference** — Run LLMs locally via llama.cpp with CUDA/Metal/Vulkan GPU acceleration
- **Code Completion** — AI-powered inline suggestions using local models
- **AI Chat** — Ask questions about your code in a built-in chat panel
- **RAG (Retrieval-Augmented Generation)** — Index and search your entire project for context-aware responses
- **Full VS Code Compatibility** — All themes, extensions, and language support work out of the box
- **Cross-Platform** — Windows, macOS, and Linux
- **Model Manager** — Download, manage, and switch between GGUF models
- **No Cloud Required** — Everything runs on your hardware

## Architecture

```
Shiryu AI Studio
        |
   AI Orchestrator
        |
   +-- llama.cpp (node-llama-cpp)
   +-- Tree-sitter (code parsing)
   +-- SQLite (memory/indexing)
   +-- LSP (language intelligence)
   +-- Git integration
```

## Requirements

- Node.js 20+
- For GPU acceleration: NVIDIA CUDA, Apple Metal, or Vulkan-compatible GPU
- RAM: 8 GB minimum, 16 GB recommended (depends on model size)

## Building from Source

```bash
git clone --depth 1 https://github.com/Shiryu-Studios-LLC/ShiryuAIStudios.git
cd ShiryuAIStudios
npm install
npm run compile
```

## Model Setup

Shiryu AI Studio uses GGUF format models. Recommended models for code:

- **Qwen2.5-Coder-14B** (Q4_K_M) — Best balance of quality and speed
- **DeepSeek-Coder-V2-Lite** (Q4_K_M) — Fast inference, good for completion
- **Codestral-22B** (Q4_K_M) — High quality, requires more VRAM

Place your `.gguf` model files in `~/.shiryu-ai-studio/models/` or use the built-in Model Manager.

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License — Copyright (c) 2026 Shiryu Studios LLC

This project is a fork of [Code - OSS](https://github.com/microsoft/vscode) (MIT License, Copyright (c) Microsoft Corporation).
