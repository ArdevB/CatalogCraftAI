import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

const base = { MONGODB_URI: 'mongodb://127.0.0.1:27017/catalogcraft' };

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      port: 4000,
      webOrigins: ['http://localhost:5173'],
      trustProxyHops: 0,
    });
  });

  it('parses comma-separated web origins', () => {
    const config = loadConfig({ ...base, WEB_ORIGIN: 'https://app.example.com, http://localhost:5173' });
    expect(config.webOrigins).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it('accepts MongoDB Atlas SRV URIs', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.net/db' })).not.toThrow();
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ ...base, PORT: '' }).port).toBe(4000);
  });

  it('reports every invalid variable by name', () => {
    try {
      loadConfig({ MONGODB_URI: 'postgres://nope', PORT: 'abc', WEB_ORIGIN: 'not a url' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('MONGODB_URI');
      expect(message).toContain('PORT');
      expect(message).toContain('WEB_ORIGIN');
    }
  });

  it('shows how a malformed MONGODB_URI begins without leaking credentials', () => {
    const attempt = () =>
      loadConfig({ MONGODB_URI: 'MONGODB_URI=mongodb+srv://user:hunter2@cluster0.example.net/db' });
    expect(attempt).toThrow('yours starts with "MONGODB_URI=mongodb+srv://…"');
    expect(attempt).not.toThrow(/hunter2/);
  });

  it('requires MONGODB_URI', () => {
    expect(() => loadConfig({})).toThrow(/MONGODB_URI/);
  });
});
