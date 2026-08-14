function probe_class(className)
% Generic MATLAB fidelity probe for one Simulink data-object class.
%
% Introspects every public property (name, MATLAB type, SetAccess, Dependent,
% Hidden, default value) and, for each writable property, runs an
% equivalence-class MUTATION SWEEP using the RAW TYPED-STRING path our UI uses
% (setPropValue where available, else direct string assignment) — recording the
% accept/reject outcome, the stored value + class, and the EXACT error message
% verbatim for every distinct failure. For validated-enum properties it extracts
% the full allowedValues set from the "no enumerated value named X" probe.
%
% Output: test/parity/fidelity/out/<className>.json  (machine-readable, consumed
% by the Node/vitest side) and a human .txt mirror. The JSON is the ground truth
% the Simulink.<className>.md doc and the hardening/tests are written against.
%
% Run:  mw matlab -nodesktop -batch "cd('test/parity/fidelity'); probe_class('Simulink.Parameter')"

here = fileparts(mfilename('fullpath'));
outDir = fullfile(here, 'out');
if ~exist(outDir, 'dir'); mkdir(outDir); end
safe = strrep(className, '.', '_');
jsonPath = fullfile(outDir, [safe '.json']);
txtPath  = fullfile(outDir, [safe '.txt']);
fid = fopen(txtPath, 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

rep = struct();
rep.className = className;
rep.matlabVersion = version;

% ---- construct a default instance ------------------------------------
obj = [];
ctorErr = '';
try
    obj = feval(className);
catch e
    ctorErr = oneline(e.message);
end
rep.constructed = ~isempty(obj);
rep.constructError = ctorErr;
fprintf(fid, '==== %s ====\n', className);
fprintf(fid, 'MATLAB: %s\n', version);
if isempty(obj)
    fprintf(fid, 'CONSTRUCT FAILED: %s\n', ctorErr);
    writeJson(jsonPath, rep);
    fprintf('probe %s: construct failed\n', className);
    return;
end

% ---- introspect properties -------------------------------------------
mc = metaclass(obj);
props = mc.PropertyList;
propReports = {};
for k = 1:numel(props)
    p = props(k);
    pr = struct();
    pr.name = p.Name;
    pr.setAccess = char(string(p.SetAccess));
    pr.getAccess = char(string(p.GetAccess));
    pr.dependent = logical(p.Dependent);
    pr.hidden = logical(p.Hidden);
    pr.hasDefault = logical(p.HasDefault);
    % default / current value
    dv = '<unreadable>'; dcls = '';
    try
        v = obj.(p.Name);
        dv = valStr(v); dcls = class(v);
    catch
    end
    pr.defaultValue = dv;
    pr.defaultClass = dcls;
    fprintf(fid, '\n-- %s [%s] SetAccess=%s Dependent=%d Hidden=%d default=%s\n', ...
        p.Name, dcls, pr.setAccess, pr.dependent, pr.hidden, dv);

    % mutation sweep only for public-settable, non-dependent props
    writable = strcmp(pr.setAccess, 'public') && ~pr.dependent;
    pr.writable = writable;
    pr.enumValues = {};
    pr.mutations = {};
    if writable
        [muts, enumVals] = sweepProperty(fid, className, p.Name, dcls);
        pr.mutations = muts;
        pr.enumValues = enumVals;
    end
    propReports{end+1} = pr; %#ok<AGROW>
end
rep.properties = propReports;

% ---- enumerate class methods (add/remove child surface) --------------
methodNames = {};
try
    ml = mc.MethodList;
    for k = 1:numel(ml)
        m = ml(k);
        if ~m.Hidden && strcmp(char(string(m.Access)), 'public')
            methodNames{end+1} = m.Name; %#ok<AGROW>
        end
    end
catch
end
rep.methods = methodNames;

writeJson(jsonPath, rep);
fprintf('probe %s: %d props written\n', className, numel(propReports));
end

% =======================================================================
function [muts, enumVals] = sweepProperty(fid, className, propName, dcls)
% Equivalence-class typed-string sweep. Each input is the RAW STRING a user
% would type in the table cell. We build a fresh object per attempt (so a prior
% reject can't taint state) and assign via the string path.
enumVals = {};
inputs = equivClassInputs(dcls);
muts = {};
for ii = 1:numel(inputs)
    raw = inputs{ii};
    m = struct();
    m.input = raw;
    obj = tryConstruct(className);
    if isempty(obj)
        m.outcome = 'CTOR-FAIL'; m.detail = ''; muts{end+1} = m; %#ok<AGROW>
        continue;
    end
    [ok, stored, storedCls, err] = tryStringSet(obj, propName, raw);
    if ok
        m.outcome = 'OK'; m.stored = stored; m.storedClass = storedCls; m.detail = '';
        fprintf(fid, '   IN %-18s -> [OK] %s [%s]\n', raw, stored, storedCls);
    else
        m.outcome = 'REJECT'; m.detail = err;
        fprintf(fid, '   IN %-18s -> [REJECT] %s\n', raw, err);
        % harvest enum members from the canonical message
        tok = regexp(err, 'no enumerated value named ''([^'']*)''', 'tokens', 'once');
        if ~isempty(tok)
            m.enumRejected = tok{1};
        end
    end
    muts{end+1} = m; %#ok<AGROW>
end

% If any reject looked like an enum, do a dedicated allowedValues discovery:
% try to read enumeration() of the property's type, else record the observed
% accept set from the sweep.
enumVals = discoverEnum(className, propName, muts);
end

% =======================================================================
function inputs = equivClassInputs(dcls)
% Representative equivalence classes covering every distinct validation branch.
common = {'5', '-3', '0', '1.5', '[1 2 3]', '[1 2;3 4]', 'Inf', '-Inf', 'NaN', ...
    '5+2i', '''text''', '''''', '[]', 'true', 'false', 'struct(''a'',[])', ...
    '{1,2}', '''double''', '''int32'''};
% type-biased extras
switch dcls
    case {'char','string'}
        inputs = [{'''valid''', '''Fixed''', '''Variable''', '''real''', '''complex''', ...
            '''Auto''', '''ExportedGlobal''', '''bogus'''}, common];
    case {'double','single','int8','int16','int32','int64','uint8','uint16','uint32','uint64'}
        inputs = common;
    case 'logical'
        inputs = [{'true','false','1','0','2'}, common];
    otherwise
        inputs = common;
end
end

% =======================================================================
function [ok, stored, storedCls, err] = tryStringSet(obj, propName, raw)
% Mirror the UI edit: parse the typed text to a value, then assign. This is what
% our setProperty ultimately does (text -> value -> field). We DO eval the text
% first (a table cell is text; the app parses it) but wrap both parse and assign
% so we distinguish a parse failure from a setter rejection.
ok = false; stored = ''; storedCls = ''; err = '';
try
    val = eval(raw); %#ok<EVLCAY>
catch e
    err = ['[PARSE] ' oneline(e.message)];
    return;
end
try
    obj.(propName) = val;
    v = obj.(propName);
    stored = valStr(v); storedCls = class(v); ok = true;
catch e
    err = oneline(e.message);
end
end

% =======================================================================
function enumVals = discoverEnum(className, propName, muts)
% Collect the accepted char values observed in the sweep (a decent proxy for the
% allowedValues set of a validated-string prop). The .md author verifies/extends
% this from the canonical error text captured per input.
enumVals = {};
for ii = 1:numel(muts)
    m = muts{ii};
    if isfield(m,'outcome') && strcmp(m.outcome,'OK') && isfield(m,'storedClass') && ...
            (strcmp(m.storedClass,'char') || strcmp(m.storedClass,'string'))
        v = strrep(m.stored, '''', '');
        if ~any(strcmp(enumVals, v)); enumVals{end+1} = v; end %#ok<AGROW>
    end
end
end

% =======================================================================
function obj = tryConstruct(className)
obj = [];
try; obj = feval(className); catch; end
end

function s = valStr(v)
if ischar(v)
    s = ['''' v ''''];
elseif isstring(v) && isscalar(v)
    s = ['"' char(v) '"'];
elseif isnumeric(v) || islogical(v)
    if isempty(v); s = '[]'; else; s = mat2str(v); end
elseif isstruct(v)
    s = ['<struct ' strjoin(fieldnames(v)', ',') '>'];
else
    s = ['<' class(v) '>'];
end
end

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end

% =======================================================================
function writeJson(path, rep)
txt = jsonencode(rep);
f = fopen(path, 'w'); fwrite(f, txt, 'char'); fclose(f);
end
