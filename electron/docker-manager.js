/**
 * Aether Orchestrator — Docker Manager
 *
 * Manages Docker containers for OpenClaw Gateway and Aether Orchestrator
 * using the dockerode library. Handles:
 * - Starting/stopping the Docker Compose stack
 * - Checking container health
 * - Streaming logs
 * - Ensuring compose files exist in userData
 */

const Docker = require('dockerode');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

class DockerManager {
    constructor({ composeFile, envFile }) {
        this.composeFile = composeFile;
        this.envFile = envFile;
        this.composeDir = path.dirname(composeFile);
        this.docker = new Docker();
        this.containerNames = {
            gateway: 'openclaw-gateway',
            aether: 'aether-orchestrator',
        };
    }

    /**
     * Check if Docker daemon is running and accessible.
     */
    async checkDocker() {
        try {
            const info = await this.docker.info();
            return {
                ok: true,
                version: info.ServerVersion,
                containers: info.Containers,
                running: info.ContainersRunning,
            };
        } catch (e) {
            return {
                ok: false,
                error: e.message.includes('ENOENT')
                    ? 'Docker is not installed. Please install Docker Desktop.'
                    : e.message.includes('ECONNREFUSED')
                        ? 'Docker daemon is not running. Please start Docker Desktop.'
                        : e.message,
            };
        }
    }

    /**
     * Start all services via docker compose up -d.
     */
    async startAll() {
        const args = [
            'compose',
            '-f', this.composeFile,
            '--env-file', this.envFile,
            'up', '-d', '--build',
        ];

        const { stdout, stderr } = await execFileAsync('docker', args, {
            cwd: this.composeDir,
            timeout: 300000, // 5 min build timeout
        });

        return { stdout, stderr };
    }

    /**
     * Stop all services via docker compose down.
     */
    async stopAll() {
        const args = [
            'compose',
            '-f', this.composeFile,
            'down',
        ];

        const { stdout, stderr } = await execFileAsync('docker', args, {
            cwd: this.composeDir,
            timeout: 60000,
        });

        return { stdout, stderr };
    }

    /**
     * Get status of all managed containers.
     */
    async getStatus() {
        const status = {};

        for (const [key, name] of Object.entries(this.containerNames)) {
            try {
                const container = this.docker.getContainer(name);
                const info = await container.inspect();
                status[key] = {
                    running: info.State.Running,
                    status: info.State.Status,
                    health: info.State.Health?.Status || 'unknown',
                    startedAt: info.State.StartedAt,
                    ports: info.NetworkSettings?.Ports || {},
                };
            } catch {
                status[key] = {
                    running: false,
                    status: 'not found',
                    health: 'unknown',
                };
            }
        }

        return { ok: true, services: status };
    }

    /**
     * Get recent logs from a specific service.
     */
    async getLogs(service = 'gateway') {
        const name = this.containerNames[service];
        if (!name) return { ok: false, error: `Unknown service: ${service}` };

        try {
            const container = this.docker.getContainer(name);
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail: 100,
                timestamps: true,
            });

            // dockerode returns a Buffer, convert to string
            const text = typeof logs === 'string' ? logs : logs.toString('utf8');
            return { ok: true, logs: text };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    /**
     * Copy docker-compose.yml, Dockerfile, and .env.template to userData
     * on first run (from extraResources bundled by electron-builder).
     */
    async ensureComposeFiles() {
        const { app } = require('electron');
        const resourcesPath = process.resourcesPath || path.join(__dirname, '..');

        const filesToCopy = [
            { src: 'docker-compose.yml', dest: this.composeFile },
            { src: '.env.template', dest: this.envFile.replace('.env', '.env.template') },
        ];

        for (const { src, dest } of filesToCopy) {
            if (!fs.existsSync(dest)) {
                const srcPath = path.join(resourcesPath, src);
                if (fs.existsSync(srcPath)) {
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(srcPath, dest);
                    console.log(`Copied ${src} to ${dest}`);
                }
            }
        }

        // Create .env from template if it doesn't exist
        if (!fs.existsSync(this.envFile)) {
            const templatePath = this.envFile.replace('.env', '.env.template');
            if (fs.existsSync(templatePath)) {
                let template = fs.readFileSync(templatePath, 'utf8');
                // Generate random tokens
                const crypto = require('crypto');
                template = template.replace(
                    'OPENCLAW_GATEWAY_TOKEN=CHANGE_ME_RUN_openssl_rand_hex_32',
                    `OPENCLAW_GATEWAY_TOKEN=${crypto.randomBytes(32).toString('hex')}`
                );
                template = template.replace(
                    'GOG_KEYRING_PASSWORD=CHANGE_ME_RUN_openssl_rand_hex_32',
                    `GOG_KEYRING_PASSWORD=${crypto.randomBytes(32).toString('hex')}`
                );
                fs.writeFileSync(this.envFile, template);
                console.log(`Created .env from template at ${this.envFile}`);
            }
        }
    }
}

module.exports = DockerManager;
