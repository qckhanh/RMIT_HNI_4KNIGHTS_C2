// Start backend (:4000), MockBank (:4100) and frontend (:5173) together. TideCloak runs in Docker
// (infra/start-tidecloak.sh). Pass --attest for Hướng 2: approved payments wait for a
// network-signed attestation and MockBank refuses anything without one.
import { spawn } from 'node:child_process';

const attest = process.argv.includes('--attest');
const services = [
  ['backend', 'backend', attest ? 'dev:attest' : 'dev'],
  ['mockbank', 'mockbank', attest ? 'dev:attest' : 'dev'],
  ['frontend', 'frontend', 'dev'],
];

const children = services.map(([name, cwd, script]) => {
  const child = spawn('npm', ['run', script], { cwd: new URL(`../${cwd}/`, import.meta.url), shell: true });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => console.log(`[${name}] ${line}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return child;
});

console.log(`Countersign ${attest ? '(Hướng 2: attestation required)' : '(Hướng 1)'} — app http://localhost:5173 · bank http://localhost:4100`);
process.on('SIGINT', () => { children.forEach((c) => c.kill()); process.exit(0); });
