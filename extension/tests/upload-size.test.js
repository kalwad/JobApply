import { describe, it, expect } from 'vitest';

/** Mirrors app/static/js/views/settings.js formatUploadSizeKb — keep in sync. */
function formatUploadSizeKb(byteSize, file) {
  if (byteSize !== null && byteSize !== undefined && byteSize !== '') {
    const n = Number(byteSize);
    if (Number.isFinite(n) && n >= 0) return `${(n / 1024).toFixed(1)} KB`;
  }
  const fromFile = file && Number(file.size);
  if (Number.isFinite(fromFile) && fromFile >= 0) return `${(fromFile / 1024).toFixed(1)} KB`;
  return '';
}

describe('formatUploadSizeKb', () => {
  it('formats numeric byte_size', () => {
    expect(formatUploadSizeKb(2048)).toBe('2.0 KB');
  });

  it('falls back to File.size when byte_size missing', () => {
    expect(formatUploadSizeKb(undefined, { size: 1024 })).toBe('1.0 KB');
  });

  it('falls back when byte_size is null', () => {
    expect(formatUploadSizeKb(null, { size: 512 })).toBe('0.5 KB');
  });

  it('falls back when byte_size is non-numeric string', () => {
    expect(formatUploadSizeKb('NaN', { size: 3072 })).toBe('3.0 KB');
  });

  it('accepts numeric string byte_size', () => {
    expect(formatUploadSizeKb('4096')).toBe('4.0 KB');
  });

  it('omits size when nothing valid', () => {
    expect(formatUploadSizeKb(undefined)).toBe('');
    expect(formatUploadSizeKb(null)).toBe('');
    expect(formatUploadSizeKb('abc')).toBe('');
  });

  it('never returns NaN', () => {
    for (const v of [undefined, null, 'x', NaN, {}, []]) {
      expect(formatUploadSizeKb(v)).not.toMatch(/NaN/i);
    }
  });
});
