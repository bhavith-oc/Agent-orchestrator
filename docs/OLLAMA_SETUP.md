# Ollama Local LLM Setup Guide

This guide explains how to set up Ollama for running local LLM models with the Aether Orchestrator.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Model Selection](#model-selection)
- [Configuration](#configuration)
- [Docker Integration](#docker-integration)
- [Troubleshooting](#troubleshooting)

## Overview

Ollama allows you to run large language models locally, eliminating API costs and providing privacy for your data. The Aether Orchestrator supports Ollama through its OpenAI-compatible API endpoint.

### Benefits

- **No API costs** - Run models locally without per-token charges
- **Privacy** - Your data never leaves your machine
- **Offline capable** - Works without internet connection
- **Fast inference** - GPU acceleration for quick responses

### Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 8GB | 16GB+ |
| Storage | 10GB | 50GB+ |
| GPU (optional) | 4GB VRAM | 8GB+ VRAM |

## Quick Start

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull qwen2.5-coder:3b

# Test the model
ollama run qwen2.5-coder:3b "Hello, how are you?"

# Configure for Docker access
sudo sed -i '/\[Service\]/a Environment="OLLAMA_HOST=0.0.0.0"' /etc/systemd/system/ollama.service
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## Installation

### Automatic Installation (Recommended)

The setup script includes Ollama installation:

```bash
./setup.sh
# When prompted, select "y" to install Ollama
```

Or install with environment variable:

```bash
INSTALL_OLLAMA=true ./setup.sh
```

### Manual Installation

#### 1. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### 2. Configure for Docker Access

By default, Ollama only listens on localhost. For Docker containers to access it, configure it to listen on all interfaces:

```bash
# Edit the systemd service
sudo sed -i '/\[Service\]/a Environment="OLLAMA_HOST=0.0.0.0"' /etc/systemd/system/ollama.service

# Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

#### 3. Verify Installation

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Test the OpenAI-compatible endpoint
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-coder:3b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Model Selection

### Recommended Models

| Model | Size | VRAM | RAM | Use Case |
|-------|------|------|-----|----------|
| `qwen2.5-coder:1.5b` | 1GB | 2GB | 4GB | Fast responses, basic tasks |
| `qwen2.5-coder:3b` | 2GB | 4GB | 8GB | **Recommended** - Good balance |
| `qwen2.5-coder:7b` | 4GB | 8GB | 16GB | Best quality, complex tasks |
| `qwen2.5-coder:14b` | 8GB | 16GB | 32GB | Professional use |

### Model Behavior Notes

⚠️ **Important**: Small models (1.5b and below) may output raw JSON instead of natural language when used with function calling. This is because they don't handle tool/function calling context well.

**Symptoms of this issue:**
```
User: Hi, how are you?
Agent: {"name": "message.send", "arguments": {"text": "Hi"}}
```

**Solution**: Use a 3b or larger model for proper conversational responses.

### Installing Models

```bash
# List available models
ollama list

# Pull a specific model
ollama pull qwen2.5-coder:3b

# Remove a model
ollama rm qwen2.5-coder:1.5b
```

### Hardware-Based Recommendations

#### GPU with 8GB+ VRAM
```bash
ollama pull qwen2.5-coder:7b
```

#### GPU with 4GB VRAM or 16GB+ RAM
```bash
ollama pull qwen2.5-coder:3b
```

#### 8GB RAM (CPU only)
```bash
ollama pull qwen2.5-coder:1.5b
# Note: Expect slower responses and potential JSON output issues
```

## Configuration

### Deploy Script Configuration

When running `./deploy.sh`, you'll be prompted for local LLM configuration:

```
── Local LLM (Ollama) ──

[i] Ollama detected on this system
Available models:
  - qwen2.5-coder:3b
  - qwen2.5-coder:1.5b

[OPTIONAL] Use local Ollama model? (Enter model name or skip): qwen2.5-coder:3b
```

### Manual .env Configuration

Add these to your `.env` file:

```env
# Local LLM (Ollama)
LOCAL_BASE_URL=http://host.docker.internal:11434/v1
LOCAL_MODEL_NAME=qwen2.5-coder:3b
LOCAL_API_KEY=ollama
```

### UI Configuration

In the Aether UI Deploy Agent page:

1. Select **"Custom / Ollama"** as the LLM provider
2. Enter:
   - **Base URL**: `http://host.docker.internal:11434/v1`
   - **API Key**: `ollama`
   - **Model Name**: `qwen2.5-coder:3b`

## Docker Integration

### How It Works

Docker containers cannot access `localhost` directly. Instead, they use `host.docker.internal` to reach the host machine.

```
┌─────────────────────────────────────────────────┐
│  Host Machine                                    │
│  ┌─────────────┐     ┌─────────────────────┐   │
│  │   Ollama    │◄────│  Docker Container   │   │
│  │ :11434      │     │  (OpenClaw Agent)   │   │
│  └─────────────┘     └─────────────────────┘   │
│        ▲                      │                 │
│        │    host.docker.internal:11434          │
│        └──────────────────────┘                 │
└─────────────────────────────────────────────────┘
```

### docker-compose.yml Configuration

The docker-compose.yml is already configured with:

```yaml
services:
  openclaw:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      LOCAL_BASE_URL: ${LOCAL_BASE_URL}
      LOCAL_MODEL_NAME: ${LOCAL_MODEL_NAME}
      LOCAL_API_KEY: ${LOCAL_API_KEY}
```

### Testing Docker Connectivity

```bash
# From inside a container
docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl \
  curl -s http://host.docker.internal:11434/api/tags
```

## Troubleshooting

### Connection Refused

**Symptom**: Container cannot connect to Ollama

**Solution**: Ensure Ollama is listening on all interfaces:

```bash
# Check current binding
ss -tlnp | grep 11434

# Should show 0.0.0.0:11434, not 127.0.0.1:11434
# If not, reconfigure:
sudo sed -i '/\[Service\]/a Environment="OLLAMA_HOST=0.0.0.0"' /etc/systemd/system/ollama.service
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

### Raw JSON Output Instead of Natural Language

**Symptom**: Agent outputs JSON like `{"name": "send", "arguments": {...}}`

**Cause**: Small models (1.5b) don't handle function calling properly

**Solution**: Use a larger model:

```bash
ollama pull qwen2.5-coder:3b
# Then update your deployment to use qwen2.5-coder:3b
```

### Slow Responses

**Symptom**: Responses take 30+ seconds

**Causes & Solutions**:

1. **CPU-only inference**: Install NVIDIA drivers for GPU acceleration
   ```bash
   # Check if GPU is being used
   nvidia-smi
   ```

2. **Model too large for RAM**: Use a smaller model
   ```bash
   ollama pull qwen2.5-coder:1.5b
   ```

3. **First request is slow**: Models are loaded on first use
   ```bash
   # Pre-warm the model
   curl http://localhost:11434/v1/chat/completions \
     -d '{"model": "qwen2.5-coder:3b", "messages": [{"role": "user", "content": "hi"}]}'
   ```

### Model Not Found

**Symptom**: Error "model not found"

**Solution**: Pull the model first:

```bash
ollama pull qwen2.5-coder:3b
ollama list  # Verify it's installed
```

### Out of Memory

**Symptom**: Ollama crashes or system becomes unresponsive

**Solution**: Use a smaller model or add swap:

```bash
# Add 8GB swap
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Commands Reference

```bash
# Installation
curl -fsSL https://ollama.com/install.sh | sh

# Service management
sudo systemctl start ollama
sudo systemctl stop ollama
sudo systemctl restart ollama
sudo systemctl status ollama

# Model management
ollama list                    # List installed models
ollama pull <model>            # Download a model
ollama rm <model>              # Remove a model
ollama run <model> "prompt"    # Interactive chat

# Testing
ollama run qwen2.5-coder:3b "Hello"

# API testing
curl http://localhost:11434/api/tags
curl http://localhost:11434/v1/models
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-coder:3b", "messages": [{"role": "user", "content": "Hello"}]}'

# Check GPU usage
nvidia-smi

# Check Ollama logs
journalctl -u ollama -f
```

## Related Documentation

- [Ollama Official Docs](https://ollama.com/docs)
- [Qwen2.5-Coder Models](https://ollama.com/library/qwen2.5-coder)
- [OpenAI API Compatibility](https://ollama.com/blog/openai-compatibility)
