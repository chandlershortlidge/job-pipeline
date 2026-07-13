// Spec C7 — client-only .docx builder.
//
// sections: [{name, bullets?: [bullet], carryText?: string}] in résumé order —
// exactly one of bullets/carryText per section (generated+approved vs carryover).
// candidateName = the first non-empty line of the _header section's carryover
// text (the résumé's own name block — NOT cv.name, which is filename-derived).
// → Blob (.docx)
//
// Single-column house template: name as Title, section names as Heading1,
// bullets as bulleted paragraphs, carryover text as plain paragraphs split on
// newlines. No tables, no columns (ATS parse rates). `_header` renders its
// carryText without a section heading (it IS the name/contact block).
export async function buildDocx({ candidateName, sections }) {
  for (const section of sections) {
    const hasBullets = section.bullets != null
    const hasCarry = section.carryText != null
    if (hasBullets === hasCarry) {
      throw new Error(
        `section "${section.name}" must carry exactly one of bullets/carryText`,
      )
    }
  }

  // Dynamic import so the docx library code-splits out of the main chunk.
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } =
    await import('docx')

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(candidateName)],
    }),
  ]

  for (const section of sections) {
    if (section.name !== '_header') {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(section.name)],
        }),
      )
    }
    if (section.bullets != null) {
      for (const bullet of section.bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun(bullet.text)],
          }),
        )
      }
    } else {
      for (const line of section.carryText.split('\n')) {
        children.push(new Paragraph({ children: [new TextRun(line)] }))
      }
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })

  return Packer.toBlob(doc)
}
