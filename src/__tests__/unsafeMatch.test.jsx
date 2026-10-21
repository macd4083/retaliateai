import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TypographyControls from '../components/ui-editor/panels/TypographyControls';
import StyleControls from '../components/ui-editor/panels/StyleControls';

describe('editor style string boundaries', () => {
  it.each([undefined, null, 42, {}])('renders malformed or missing style values safely: %s', (value) => {
    const selectedNode = { styles: { color: value, backgroundColor: value, borderColor: value } };
    expect(() => renderToStaticMarkup(
      <TypographyControls selectedNode={selectedNode} applyStyle={() => {}} />
    )).not.toThrow();
    expect(() => renderToStaticMarkup(
      <StyleControls selectedNode={selectedNode} applyStyle={() => {}} applyAttr={() => {}} />
    )).not.toThrow();
  });
});
