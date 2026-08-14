function rt_verify(slddPath)
  % Reopen an edited .sldd (written by the extension's write-back transforms) and
  % assert every property change survived a real MATLAB load. MyGadget/MyEngine must
  % be on the path. Prints PASS/FAIL lines; a wrong readback is a FAIL, not an error.
  d = Simulink.data.dictionary.open(slddPath);
  e = getEntry(getSection(d,'Other Data'), 'gadget');
  g = getValue(e);
  Simulink.data.dictionary.closeAll('-discard');

  chk('Wheels',            g.Wheels,            8);
  chk('Engine.Cylinders',  g.Engine.Cylinders,  16);
  chk('Engine.Displacement (untouched)', g.Engine.Displacement, 6.2);
  chk('Specs.mass',        g.Specs.mass,        2000);
  chk('Specs.field (added)', g.Specs.field,     0);
  chkstr('Name (untouched)', g.Name, 'Roadster');
  chkstr('Tags{2}',        g.Tags{2},           'zoom');
  chkstr('Tags{1} (untouched)', g.Tags{1},      'coupe');
  chkstr('Tags{3} (untouched)', g.Tags{3},      'v12');
  chktrue('Specs.color removed', ~isfield(g.Specs,'color'));
end

function chk(name, actual, expected)
  if isequal(actual, expected)
    fprintf('PASS %s = %g\n', name, actual);
  else
    fprintf('FAIL %s: got %s expected %g\n', name, mat2str(actual), expected);
  end
end
function chkstr(name, actual, expected)
  a = char(actual);
  if strcmp(a, expected)
    fprintf('PASS %s = %s\n', name, a);
  else
    fprintf('FAIL %s: got "%s" expected "%s"\n', name, a, expected);
  end
end
function chktrue(name, cond)
  if cond, fprintf('PASS %s\n', name); else fprintf('FAIL %s\n', name); end
end
