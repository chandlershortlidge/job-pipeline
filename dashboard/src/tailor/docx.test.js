import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { buildDocx } from './docx.js'

// ---- helpers (test-only, per spec verification C7) ----

// Normalize buildDocx output (Blob or Buffer-backed blob) to a Node Buffer.
async function toBytes(out) {
  if (out && typeof out.arrayBuffer === 'function') {
    return Buffer.from(await out.arrayBuffer())
  }
  return Buffer.from(out)
}

// Minimal zip reader: walk the central directory, find `name`, return its
// (inflated if DEFLATEd) bytes. docx@9 compression is not guaranteed STOREd,
// so the marker check falls back to this when the raw byte scan misses.
function extractZipEntry(buf, name) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) return null
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const fnLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const fname = buf.toString('utf8', off + 46, off + 46 + fnLen)
    if (fname === name) {
      const lFnLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lFnLen + lExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      return method === 8 ? inflateRawSync(data) : data
    }
    off += 46 + fnLen + extraLen + commentLen
  }
  return null
}

// Spec C7 verification: search Packer output raw bytes for the marker's UTF-8
// bytes; if the raw scan misses, inflate word/document.xml and search the
// inflated text; only then fail.
async function containsMarker(out, marker) {
  const bytes = await toBytes(out)
  if (bytes.includes(Buffer.from(marker, 'utf8'))) return true
  const xml = extractZipEntry(bytes, 'word/document.xml')
  if (!xml) return false
  return xml.toString('utf8').includes(marker)
}

// ---- fixtures ----

const MARKER = 'ZZ-marker-bullet-7f3a9c'

const happySections = () => ([
  {
    name: 'Experience',
    bullets: [
      { text: MARKER, claim_ids: ['claim-1'] },
      { text: 'Shipped a thing that mattered', claim_ids: ['claim-2'] },
    ],
  },
  {
    name: 'Education',
    carryText: 'BS in Computer Science, Some University',
  },
])

// ---- tests ----

describe('buildDocx (spec C7)', () => {
  it('builds a non-empty Blob from one bullets section + one carryText section', async () => {
    const out = await buildDocx({ candidateName: 'Jane Doe', sections: happySections() })
    expect(out).toBeInstanceOf(Blob)
    expect(out.size).toBeGreaterThan(0)
  })

  it('contains the marker bullet text (raw byte scan, zlib-inflate fallback on word/document.xml)', async () => {
    const out = await buildDocx({ candidateName: 'Jane Doe', sections: happySections() })
    expect(await containsMarker(out, MARKER)).toBe(true)
  })

  it('still builds when carryText contains newlines', async () => {
    const out = await buildDocx({
      candidateName: 'Jane Doe',
      sections: [
        { name: 'Summary', carryText: 'Line one\nLine two\n\nLine four' },
      ],
    })
    expect(out.size).toBeGreaterThan(0)
  })

  it('rejects a section carrying BOTH bullets and carryText', async () => {
    await expect(buildDocx({
      candidateName: 'Jane Doe',
      sections: [
        {
          name: 'Experience',
          bullets: [{ text: 'a bullet', claim_ids: ['claim-1'] }],
          carryText: 'also carried over',
        },
      ],
    })).rejects.toThrow()
  })

  it('rejects a section carrying NEITHER bullets nor carryText', async () => {
    await expect(buildDocx({
      candidateName: 'Jane Doe',
      sections: [{ name: 'Experience' }],
    })).rejects.toThrow()
  })
})
