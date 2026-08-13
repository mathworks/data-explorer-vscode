function gen_codegen_fixture()
% GEN_CODEGEN_FIXTURE  Discover + capture the Code Generation object-properties
% that a default Simulink.Parameter/Signal does NOT expose (Data Scope, Header
% File, Preserve Dimensions, Dimensions Mode), so the schema can be seeded from
% real data instead of a guessed source path.
%
% For each of Parameter and Signal it:
%   1. tries to set every candidate property to a DISTINCTIVE non-default value,
%      recording success/failure + the resolved location (top-level vs CoderInfo
%      vs CoderInfo.CustomAttributes) — defensively, so unsupported props are
%      documented, not fatal;
%   2. recursively dumps the object's full property tree (paths + values) to
%      codegen_probe.txt;
%   3. saves both objects into artifacts/{text,binary}/codegen.sldd.
%
% Run:  matlab -batch "cd('test/parity'); gen_codegen_fixture"

here = fileparts(mfilename('fullpath'));
root = fullfile(here, 'artifacts');
probePath = fullfile(here, 'codegen_probe.txt');
fid = fopen(probePath, 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

Simulink.data.dictionary.closeAll('-discard');

% ---- Build the two objects with as many code-gen props set as possible ----
[p, pReport] = buildParam();
[s, sReport] = buildSignal();

fprintf(fid, '==== SET REPORT: Simulink.Parameter ====\n');
writeReport(fid, pReport);
fprintf(fid, '\n==== SET REPORT: Simulink.Signal ====\n');
writeReport(fid, sReport);

% Fresh (untouched) objects so the OMITTED-DEFAULT of each candidate property
% is captured, not the value we forced above.
freshP = Simulink.Parameter(9.81);
freshS = Simulink.Signal;
fprintf(fid, '\n==== DEFAULTS: fresh Simulink.Parameter ====\n');
logDefault(fid, freshP, 'DimensionsMode');
logDefault(fid, freshP, 'Dimensions');
logDefault(fid, freshP, 'Complexity');
fprintf(fid, '\n==== DEFAULTS: fresh Simulink.Signal ====\n');
logDefault(fid, freshS, 'DimensionsMode');
logDefault(fid, freshS, 'Dimensions');
logDefault(fid, freshS, 'Complexity');

fprintf(fid, '\n==== PROPERTY TREE: Simulink.Parameter (cgParam) ====\n');
dumpTree(fid, p, '', 0);
fprintf(fid, '\n==== PROPERTY TREE: Simulink.Signal (cgSignal) ====\n');
dumpTree(fid, s, '', 0);

% ---- Save into codegen.sldd for both on-disk formats ----
saveVariant(fullfile(root, 'text'),   'uncompressed-text', p, s);
saveVariant(fullfile(root, 'binary'), 'compressed-binary', p, s);

disp('codegen fixture generated.');
disp(['probe written to ' probePath]);
end

% ========================================================================
function [p, report] = buildParam()
report = struct('tries', {{}});
p = Simulink.Parameter(9.81);
p.DataType = 'double';
p.Description = 'codegen param';
% A storage class that carries a HeaderFile/DataScope custom-attribute set.
report = trySet(report, @() setSC(p, 'ExportedGlobal'), 'CoderInfo.StorageClass=ExportedGlobal');
% Header file + data scope live on CoderInfo (directly or via CustomAttributes,
% depending on release) — try both spellings.
report = trySet(report, @() setField(p.CoderInfo, 'HeaderFile', 'gravity.h'), 'CoderInfo.HeaderFile');
report = trySet(report, @() setField(p.CoderInfo.CustomAttributes, 'HeaderFile', 'gravity.h'), 'CoderInfo.CustomAttributes.HeaderFile');
report = trySet(report, @() setField(p.CoderInfo, 'DataScope', 'Exported'), 'CoderInfo.DataScope');
report = trySet(report, @() setField(p.CoderInfo.CustomAttributes, 'DataScope', 'Exported'), 'CoderInfo.CustomAttributes.DataScope');
% Dimensions handling.
report = trySet(report, @() setField(p, 'DimensionsMode', 'Fixed'), 'DimensionsMode');
report = trySet(report, @() setField(p, 'PreserveDimensions', true), 'PreserveDimensions');
report = trySet(report, @() setField(p.CoderInfo, 'PreserveDimensions', true), 'CoderInfo.PreserveDimensions');
end

% ------------------------------------------------------------------------
function [s, report] = buildSignal()
report = struct('tries', {{}});
s = Simulink.Signal;
s.DataType = 'double';
s.Description = 'codegen signal';
report = trySet(report, @() setSC(s, 'ExportedGlobal'), 'CoderInfo.StorageClass=ExportedGlobal');
report = trySet(report, @() setField(s.CoderInfo, 'HeaderFile', 'sig.h'), 'CoderInfo.HeaderFile');
report = trySet(report, @() setField(s.CoderInfo.CustomAttributes, 'HeaderFile', 'sig.h'), 'CoderInfo.CustomAttributes.HeaderFile');
report = trySet(report, @() setField(s.CoderInfo, 'DataScope', 'Exported'), 'CoderInfo.DataScope');
report = trySet(report, @() setField(s.CoderInfo.CustomAttributes, 'DataScope', 'Exported'), 'CoderInfo.CustomAttributes.DataScope');
report = trySet(report, @() setField(s, 'DimensionsMode', 'Fixed'), 'DimensionsMode');
report = trySet(report, @() setField(s, 'PreserveDimensions', true), 'PreserveDimensions');
report = trySet(report, @() setField(s.CoderInfo, 'PreserveDimensions', true), 'CoderInfo.PreserveDimensions');
end

% ------------------------------------------------------------------------
function setSC(obj, sc)
obj.CoderInfo.StorageClass = sc;
end
function setField(obj, name, val)
obj.(name) = val;
end

function report = trySet(report, fcn, label)
t = struct('label', label, 'ok', false, 'err', '');
try
    fcn();
    t.ok = true;
catch err
    t.err = err.message;
end
report.tries{end+1} = t;
end

function writeReport(fid, report)
for i = 1:numel(report.tries)
    t = report.tries{i};
    if t.ok
        fprintf(fid, '  [OK]   %s\n', t.label);
    else
        fprintf(fid, '  [FAIL] %s  -- %s\n', t.label, oneline(t.err));
    end
end
end

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end

function logDefault(fid, obj, name)
try
    val = obj.(name);
    if ischar(val)
        fprintf(fid, '  %s = ''%s''  [char]\n', name, val);
    elseif isstring(val) && isscalar(val)
        fprintf(fid, '  %s = "%s"  [string]\n', name, val);
    elseif (isnumeric(val) || islogical(val))
        fprintf(fid, '  %s = %s  [%s]\n', name, mat2str(val), class(val));
    else
        fprintf(fid, '  %s : <%s>\n', name, class(val));
    end
catch err
    fprintf(fid, '  %s = <absent: %s>\n', name, oneline(err.message));
end
end

% ------------------------------------------------------------------------
function dumpTree(fid, obj, prefix, depth)
% Recursively print property paths + scalar values. Bounded depth; only
% recurses into Simulink*/SimulinkCSC* objects and structs to avoid handle-graph
% cycles.
if depth > 4; return; end
try
    props = properties(obj);
catch
    return;
end
for i = 1:numel(props)
    name = props{i};
    path = name;
    if ~isempty(prefix); path = [prefix '.' name]; end
    try
        val = obj.(name);
    catch err
        fprintf(fid, '  %s = <unreadable: %s>\n', path, oneline(err.message));
        continue;
    end
    cls = class(val);
    if ischar(val)
        fprintf(fid, '  %s = ''%s''  [char]\n', path, val);
    elseif isstring(val) && isscalar(val)
        fprintf(fid, '  %s = "%s"  [string]\n', path, val);
    elseif (isnumeric(val) || islogical(val)) && isscalar(val)
        fprintf(fid, '  %s = %s  [%s]\n', path, mat2str(val), cls);
    elseif (isnumeric(val) || islogical(val))
        fprintf(fid, '  %s = %s  [%s]\n', path, mat2str(val), cls);
    else
        fprintf(fid, '  %s : <%s>\n', path, cls);
        if startsWith(cls, 'Simulink') || startsWith(cls, 'SimulinkCSC') || isstruct(val)
            dumpTree(fid, val, path, depth + 1);
        end
    end
end
end

% ------------------------------------------------------------------------
function saveVariant(outDir, fmt, p, s)
if ~exist(outDir, 'dir'); mkdir(outDir); end
old = cd(outDir);
c = onCleanup(@() cd(old)); %#ok<NASGU>
if exist('codegen.sldd', 'file'); delete('codegen.sldd'); end
Simulink.data.dictionary.closeAll('-discard');
% FileFormat is a create-time option in this release; setting the property
% post-hoc is not supported. Fall back to a plain create if the option name
% differs so the entries still get saved.
try
    dd = Simulink.data.dictionary.create('codegen.sldd', 'FileFormat', fmt);
catch
    dd = Simulink.data.dictionary.create('codegen.sldd');
end
sec = getSection(dd, 'Design Data');
sec.addEntry('cgParam', p);
sec.addEntry('cgSignal', s);
saveChanges(dd); close(dd);
end
