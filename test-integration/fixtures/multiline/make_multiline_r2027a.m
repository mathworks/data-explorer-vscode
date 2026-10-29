function make_multiline_r2027a(outDir)
  % Copyright 2026 The MathWorks, Inc.
  % Authors multiline_r2027a.mat, multiline_r2027a_text.sldd and multiline_r2027a_binary.sldd:
  % the same three Simulink.Parameter objects in a MAT-file and in a dictionary of each format,
  % whose Descriptions MATLAB itself wrote with line breaks, so the integration tests can open,
  % edit and save a multi-line Description in each table editor (multiLineDescription.test.ts):
  %
  %   pLF    Value 3, Description 'two' LF 'lines, it''s'  (newline, MATLAB's own line break)
  %   pCRLF  Value 4, Description 'first line' CR LF 'second line'
  %   pOne   Value 5, Description 'one line'
  %
  % Run in MATLAB R2027a: make_multiline_r2027a(outDir), `outDir` defaulting to this folder. It
  % prints each Description read back from each file as its character codes. The committed files
  % were written by R2027a on 2026-10-26; a re-run gives new UUIDs and timestamps, and the same
  % values.
  if nargin < 1 || isempty(outDir)
    outDir = fileparts(mfilename('fullpath'));
  end
  fprintf('VERSION %s\n', version);
  [pLF, pCRLF, pOne] = params();
  matFile = fullfile(outDir, 'multiline_r2027a.mat');
  save(matFile, 'pLF', 'pCRLF', 'pOne');
  S = load(matFile);
  for name = {'pLF', 'pCRLF', 'pOne'}
    fprintf('READBACK mat %s %s\n', name{1}, mat2str(double(S.(name{1}).Description)));
  end

  Simulink.data.dictionary.closeAll('-discard');
  formats = {'uncompressed-text', 'text'; 'compressed-binary', 'binary'};
  for i = 1:size(formats, 1)
    fn = fullfile(outDir, ['multiline_r2027a_' formats{i, 2} '.sldd']);
    if exist(fn, 'file'), delete(fn); end
    dd = Simulink.data.dictionary.create(fn);
    dd.FileFormat = formats{i, 1};
    ds = dd.getSection('Design Data');
    ds.addEntry('pLF', pLF);
    ds.addEntry('pCRLF', pCRLF);
    ds.addEntry('pOne', pOne);
    clear ds
    dd.saveChanges();
    dd.close();
    dd = Simulink.data.dictionary.open(fn);
    ds = dd.getSection('Design Data');
    for name = {'pLF', 'pCRLF', 'pOne'}
      v = ds.getEntry(name{1}).getValue;
      fprintf('READBACK %s %s %s\n', formats{i, 2}, name{1}, mat2str(double(v.Description)));
    end
    clear ds
    dd.close();
  end
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('MAKE_MULTILINE_R2027A_DONE\n');
end

function [pLF, pCRLF, pOne] = params()
  pLF = Simulink.Parameter(3);
  pLF.Description = ['two' newline 'lines, it''s'];
  pCRLF = Simulink.Parameter(4);
  pCRLF.Description = ['first line' char([13 10]) 'second line'];
  pOne = Simulink.Parameter(5);
  pOne.Description = 'one line';
end
