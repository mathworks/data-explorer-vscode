// Copyright 2026 The MathWorks, Inc.
// Regression tests for block-parameter extraction (issue #9): the parser must
// capture parameter references from ANY block type, not just a hardcoded allowlist
// of Gain/Value/... props. A TransferFcn keeps its coefficients in
// Numerator/Denominator; those blocks used to be dropped entirely, so they never
// appeared as Modeling Elements and the workspace variables they referenced showed
// empty Usage. The fix scans every non-cosmetic <P> and keeps values that contain
// an identifier (so operator-only patterns like a Sum's `Inputs=|++` stay out).
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSlx } from '../src/dex/datamodel/parser/SlxParser.js';

// Build an in-memory .slx with a single systems file holding the given <Block>
// XML. Only the pieces parseSlx reads for block params are included.
function slxWithBlocks(blocksXml: string): ArrayBuffer {
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
    'simulink/systems/system_root.xml': strToU8(
      `<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`,
    ),
    'metadata/coreProperties.xml': strToU8(`<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`),
  };
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function usagesFor(blocksXml: string) {
  return parseSlx(slxWithBlocks(blocksXml), 'm.slx').blockParamUsages;
}

describe('block param usage extraction (blocklist + identifier gate)', () => {
  it('captures a TransferFcn Numerator/Denominator (not on the old allowlist)', () => {
    const usages = usagesFor(
      `<Block BlockType="TransferFcn" Name="Filt" SID="1">` +
        `<P Name="Numerator">[1,W1]</P><P Name="Denominator">[Tal,1]</P>` +
        `</Block>`,
    );
    expect(usages).toEqual([
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Numerator', paramValue: '[1,W1]' },
      { blockName: 'Filt', blockType: 'TransferFcn', paramProperty: 'Denominator', paramValue: '[Tal,1]' },
    ]);
  });

  it('still captures a Gain param (allowlist behavior preserved)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G1" SID="1"><P Name="Gain">Mq</P></Block>`);
    expect(usages).toEqual([{ blockName: 'G1', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Mq' }]);
  });

  it('captures an expression that contains an identifier (1/Uo)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">1/Uo</P></Block>`);
    expect(usages).toHaveLength(1);
    expect(usages[0].paramValue).toBe('1/Uo');
  });

  it("drops a Sum's operator-only Inputs pattern (|++) — no identifier, not a data ref", () => {
    const usages = usagesFor(`<Block BlockType="Sum" Name="S1" SID="1"><P Name="Inputs">|++</P></Block>`);
    expect(usages).toEqual([]);
  });

  it('drops purely numeric param values (Gain=22.8)', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">22.8</P></Block>`);
    expect(usages).toEqual([]);
  });

  it('drops cosmetic/structural props even when they hold identifier-like text', () => {
    const usages = usagesFor(
      `<Block BlockType="Gain" Name="G" SID="1">` +
        `<P Name="Position">[35, 180, 65, 210]</P>` +
        `<P Name="FontName">Arial</P>` +
        `<P Name="OutDataTypeStr">Inherit: Inherit via internal rule</P>` +
        `<P Name="Gain">Kp</P>` +
        `</Block>`,
    );
    // Only the real parameter (Gain=Kp) survives; Position/FontName/OutDataTypeStr
    // are on the non-param skip list.
    expect(usages).toEqual([{ blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'Kp' }]);
  });

  it('drops on/off toggle values', () => {
    const usages = usagesFor(`<Block BlockType="Gain" Name="G" SID="1"><P Name="SomeFlag">on</P></Block>`);
    expect(usages).toEqual([]);
  });

  describe('multi-line block-name normalization (&#xA; = newline)', () => {
    it('collapses a hex newline entity in the block name to a single space', () => {
      // Simulink wraps long labels; the raw SLX stores the break as &#xA;, which
      // fast-xml-parser leaves undecoded. It must render as one flat cell.
      const usages = usagesFor(
        `<Block BlockType="TransferFcn" Name="Alpha-sensor&#xA;Low-pass Filter" SID="1"><P Name="Denominator">[Tal,1]</P></Block>`,
      );
      expect(usages).toHaveLength(1);
      expect(usages[0].blockName).toBe('Alpha-sensor Low-pass Filter');
    });

    it('collapses multiple newline entities and surrounding whitespace', () => {
      const usages = usagesFor(
        `<Block BlockType="TransferFcn" Name="Proportional&#xA;plus integral&#xA;compensator" SID="1"><P Name="Numerator">[Ki]</P></Block>`,
      );
      expect(usages[0].blockName).toBe('Proportional plus integral compensator');
    });

    it('handles the decimal newline form (&#10;) too', () => {
      const usages = usagesFor(
        `<Block BlockType="Gain" Name="Line1&#10;Line2" SID="1"><P Name="Gain">Kp</P></Block>`,
      );
      expect(usages[0].blockName).toBe('Line1 Line2');
    });

    it('a name that is only a newline normalizes to empty (not a literal &#xA;)', () => {
      const usages = usagesFor(`<Block BlockType="Constant" Name="&#xA;" SID="1"><P Name="Value">Uo</P></Block>`);
      expect(usages[0].blockName).toBe('');
    });
  });
});
