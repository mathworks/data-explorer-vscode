function gen()
% Generate MCOS test fixtures with KNOWN NON-DEFAULT values in 4 formats:
% .mat, .slx (model workspace), .sldd (binary). JSON export handled outside.
% Emits a manifest.json describing expected scalar property values.
outdir = '/tmp/mcos_fix/out';
if exist(outdir,'dir'); rmdir(outdir,'s'); end
mkdir(outdir);

manifest = struct();
specs = local_specs();

% Build one struct of all objects for the .mat and one dictionary + one model.
objs = struct();
for i = 1:numel(specs)
    s = specs{i};
    try
        obj = s.make();
        objs.(s.name) = obj;
        manifest.(s.name) = s.expect;
        fprintf('MADE %s (%s)\n', s.name, class(obj));
    catch e
        fprintf('FAIL_MAKE %s: %s\n', s.name, e.message);
    end
end

names = fieldnames(objs);

% --- .mat: one file per object (so parser sees a single named var) ---
for i = 1:numel(names)
    n = names{i};
    v = objs.(n); %#ok<NASGU>
    tmp = struct(); tmp.(n) = objs.(n);
    save(fullfile(outdir,[n '.mat']), '-struct', 'tmp');
end
fprintf('MAT_DONE\n');

% --- .sldd (binary): all objects in Design Data ---
slddPath = fullfile(outdir,'all.sldd');
if exist(slddPath,'file'); delete(slddPath); end
dd = Simulink.data.dictionary.create(slddPath);
sec = getSection(dd,'Design Data');
for i = 1:numel(names)
    n = names{i};
    try
        addEntry(sec, n, objs.(n));
    catch e
        fprintf('FAIL_SLDD_ADD %s: %s\n', n, e.message);
    end
end
saveChanges(dd);
fprintf('SLDD_DONE\n');

% --- .slx: all objects in model workspace ---
mdl = 'mcosfix';
if bdIsLoaded(mdl); close_system(mdl,0); end
new_system(mdl);
hws = get_param(mdl,'ModelWorkspace');
for i = 1:numel(names)
    n = names{i};
    try
        assignin(hws, n, objs.(n));
    catch e
        fprintf('FAIL_SLX_ADD %s: %s\n', n, e.message);
    end
end
save_system(mdl, fullfile(outdir,'mcosfix.slx'));
close_system(mdl,0);
fprintf('SLX_DONE\n');

% --- manifest ---
fid = fopen(fullfile(outdir,'manifest.json'),'w');
fwrite(fid, jsonencode(manifest));
fclose(fid);
fprintf('MANIFEST_DONE\n');
end

function specs = local_specs()
specs = {};

specs{end+1} = struct('name','Param', 'make', @() mkParam(), 'expect', ...
    struct('class','Simulink.Parameter','Value',42,'Min',-1,'Max',100,'DataType','int32','Unit','m/s','Description','hello'));

specs{end+1} = struct('name','ParamMat', 'make', @() mkParamMat(), 'expect', ...
    struct('class','Simulink.Parameter','DataType','double','Description','matrix'));

specs{end+1} = struct('name','Sig', 'make', @() mkSig(), 'expect', ...
    struct('class','Simulink.Signal','Min',-5,'Max',5,'DataType','single','Unit','V','Description','sigdesc'));

specs{end+1} = struct('name','Numeric', 'make', @() mkNumeric(), 'expect', ...
    struct('class','Simulink.NumericType','Description','numdesc'));

specs{end+1} = struct('name','Alias', 'make', @() mkAlias(), 'expect', ...
    struct('class','Simulink.AliasType','BaseType','int16','Description','aliasdesc'));

specs{end+1} = struct('name','Bp', 'make', @() Simulink.Breakpoint(), 'expect', ...
    struct('class','Simulink.Breakpoint'));

specs{end+1} = struct('name','Lut', 'make', @() Simulink.LookupTable(), 'expect', ...
    struct('class','Simulink.LookupTable'));

specs{end+1} = struct('name','VarCtrl', 'make', @() mkVarCtrl(), 'expect', ...
    struct('class','Simulink.VariantControl','ValueType','Numeric'));
end

function p = mkParam()
p = Simulink.Parameter;
p.Value = 42; p.Min = -1; p.Max = 100;
p.DataType = 'int32'; p.Unit = 'm/s'; p.Description = 'hello';
end

function p = mkParamMat()
p = Simulink.Parameter;
p.Value = [1 2 3; 4 5 6];
p.Description = 'matrix';
end

function s = mkSig()
s = Simulink.Signal;
s.Min = -5; s.Max = 5;
s.DataType = 'single'; s.Unit = 'V'; s.Description = 'sigdesc';
end

function n = mkNumeric()
n = Simulink.NumericType;
n.Description = 'numdesc';
end

function a = mkAlias()
a = Simulink.AliasType;
a.BaseType = 'int16';
a.Description = 'aliasdesc';
end

function v = mkVarCtrl()
v = Simulink.VariantControl('Value', 1, 'ValueType', 'Numeric');
end
