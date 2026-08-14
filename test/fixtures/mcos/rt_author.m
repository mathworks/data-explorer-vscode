function rt_author()
  % Author the issue-#3 round-trip fixtures: a custom-class object `gadget` with
  % NON-DEFAULT scalar / nested-object / struct / cell property values (so every
  % property is serialized into the instance block), saved as BOTH a JSON-text
  % .sldd and a compressed-binary (zip/XML) .sldd. Run from a MATLAB with MyGadget
  % and MyEngine on the path; copy the two outputs to test/fixtures/{rt_text,rt_bin}.sldd.
  % Custom objects go in the "Other Data" section — "Design Data" rejects them.
  for f = {'rt_text.sldd','rt_bin.sldd'}
    if isfile(f{1}), delete(f{1}); end
  end
  g = MyGadget;
  g.Wheels = 4;
  g.Name = 'Roadster';
  e = MyEngine; e.Cylinders = 12; e.Displacement = 6.2;
  g.Engine = e;
  g.Specs = struct('mass', 1500, 'color', 'red');
  g.Tags = {'coupe','fast','v12'};

  % TEXT (JSON) — the R2027a default format.
  dt = Simulink.data.dictionary.create('rt_text.sldd');
  addEntry(getSection(dt,'Other Data'), 'gadget', g);
  saveChanges(dt);
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('TEXT bytes=%d\n', dir('rt_text.sldd').bytes);

  % BINARY (compressed-binary zip/XML) — set FileFormat before saving.
  db = Simulink.data.dictionary.create('rt_bin.sldd');
  addEntry(getSection(db,'Other Data'), 'gadget', g);
  db.FileFormat = 'compressed-binary';
  saveChanges(db);
  Simulink.data.dictionary.closeAll('-discard');
  fprintf('BIN bytes=%d\n', dir('rt_bin.sldd').bytes);
end
