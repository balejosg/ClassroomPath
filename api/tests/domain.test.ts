import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getRootDomain } from '../src/utils/domain.js';

describe('getRootDomain', () => {
  it('should extract root domain from simple domain', () => {
    assert.strictEqual(getRootDomain('google.com'), 'google.com');
  });

  it('should extract root domain from subdomain', () => {
    assert.strictEqual(getRootDomain('mail.google.com'), 'google.com');
  });

  it('should extract root domain from deep subdomain', () => {
    assert.strictEqual(getRootDomain('a.b.c.d.example.com'), 'example.com');
  });

  it('should handle ccTLDs (co.uk)', () => {
    assert.strictEqual(getRootDomain('bbc.co.uk'), 'bbc.co.uk');
    assert.strictEqual(getRootDomain('www.bbc.co.uk'), 'bbc.co.uk');
    assert.strictEqual(getRootDomain('news.bbc.co.uk'), 'bbc.co.uk');
  });

  it('should handle ccTLDs (co.jp)', () => {
    assert.strictEqual(getRootDomain('amazon.co.jp'), 'amazon.co.jp');
    assert.strictEqual(getRootDomain('www.amazon.co.jp'), 'amazon.co.jp');
  });

  it('should handle ccTLDs (com.ar)', () => {
    assert.strictEqual(getRootDomain('example.com.ar'), 'example.com.ar');
    assert.strictEqual(getRootDomain('sub.example.com.ar'), 'example.com.ar');
  });

  it('should strip path from domain', () => {
    assert.strictEqual(getRootDomain('google.com/search'), 'google.com');
    assert.strictEqual(getRootDomain('example.com/admin/panel'), 'example.com');
  });

  it('should strip protocol', () => {
    assert.strictEqual(getRootDomain('https://google.com'), 'google.com');
    assert.strictEqual(getRootDomain('http://mail.google.com'), 'google.com');
  });

  it('should strip www prefix', () => {
    assert.strictEqual(getRootDomain('www.google.com'), 'google.com');
  });

  it('should strip port', () => {
    assert.strictEqual(getRootDomain('google.com:8080'), 'google.com');
  });

  it('should handle wildcards', () => {
    assert.strictEqual(getRootDomain('*.google.com'), 'google.com');
  });

  it('should handle query strings and fragments', () => {
    assert.strictEqual(getRootDomain('google.com?q=test'), 'google.com');
    assert.strictEqual(getRootDomain('google.com#section'), 'google.com');
  });

  it('should return value for single-label domains', () => {
    assert.strictEqual(getRootDomain('localhost'), 'localhost');
  });
});
