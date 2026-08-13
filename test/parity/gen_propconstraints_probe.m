function gen_propconstraints_probe()
% GEN_PROPCONSTRAINTS_PROBE  Discover the REAL setPropValue constraints MATLAB
% enforces for the properties we opened for editing in the table, so we can
% mirror the exact same validation (and stay conservative — read-only where a
% constraint is unknown or a bad value could corrupt the object).
%
% We drive edits through Simulink.DataObject/setPropValue (the DDG path the UI
% uses), NOT direct dot-assignment, because that is the layer that produces the
% user-facing "Minimum must be a finite real double scalar value" errors.
%
% For each (class, property) it sweeps a battery of candidate string inputs and
% records, verbatim, whether MATLAB accepted or rejected each — and the exact
% error text on rejection. The output (propconstraints_probe.txt) is the ground
% truth we encode in ParameterNode/SignalNode setProperty + the schema editors.
%
% Run:  matlab -batch "cd('test/parity'); gen_propconstraints_probe"

here = fileparts(mfilename('fullpath'));
probePath = fullfile(here, 'propconstraints_probe.txt');
fid = fopen(probePath, 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

Simulink.data.dictionary.closeAll('-discard');

% The inputs are passed as the RAW STRING a user would type into a cell, since
% that is exactly what our setProperty receives. setPropValue takes the typed
% value, so we eval the string to a MATLAB value first (mirroring how a real
% property dialog parses the text), and record parse failures too.
inputs = { ...
    '5', ...
    '-3.5', ...
    '0', ...
    '', ...
    '[]', ...
    '[5 6]', ...
    '[5;6]', ...
    'Inf', ...
    '-Inf', ...
    'NaN', ...
    '1e3', ...
    '5+2i', ...
    'abc', ...
    '  7  ' ...     % surrounding whitespace
};

% Unit / string-valued candidates (Unit is a char property).
unitInputs = { 'm/s', 'kg', '', '5', '[1 2]', 'seconds' };

% Alignment candidates (integer-ish typed text).
alignInputs = { '-1', '0', '1', '8', '3.5', '', '[1 2]', 'Inf', 'NaN', 'x', '2.0', '16' };

probeClass(fid, 'Simulink.Parameter', @() Simulink.Parameter(1.0), ...
    {'Min', 'Max'}, inputs);
probeClass(fid, 'Simulink.Signal', @() Simulink.Signal, ...
    {'Min', 'Max'}, inputs);

probeClass(fid, 'Simulink.Parameter', @() Simulink.Parameter(1.0), ...
    {'Unit'}, unitInputs);
probeClass(fid, 'Simulink.Signal', @() Simulink.Signal, ...
    {'Unit'}, unitInputs);

% DocUnits — the property our node actually serializes for "Unit".
probeClass(fid, 'Simulink.Parameter', @() Simulink.Parameter(1.0), ...
    {'DocUnits'}, unitInputs);

% Alignment lives on CoderInfo; setPropValue targets the CoderInfo sub-object.
probeCoderInfo(fid, 'Simulink.Parameter', @() Simulink.Parameter(1.0), ...
    {'Alignment'}, alignInputs);
probeCoderInfo(fid, 'Simulink.Signal', @() Simulink.Signal, ...
    {'Alignment'}, alignInputs);

disp('propconstraints probe written to');
disp(probePath);
end

% ========================================================================
function probeClass(fid, className, ctor, props, inputs)
for pi = 1:numel(props)
    prop = props{pi};
    fprintf(fid, '\n==== %s :: setPropValue(''%s'', ...) ====\n', className, prop);
    for ii = 1:numel(inputs)
        raw = inputs{ii};
        obj = ctor();
        report(fid, obj, prop, raw);
    end
end
end

% ------------------------------------------------------------------------
function probeCoderInfo(fid, className, ctor, props, inputs)
for pi = 1:numel(props)
    prop = props{pi};
    fprintf(fid, '\n==== %s :: CoderInfo.setPropValue(''%s'', ...) ====\n', className, prop);
    for ii = 1:numel(inputs)
        raw = inputs{ii};
        obj = ctor();
        report(fid, obj.CoderInfo, prop, raw);
    end
end
end

% ------------------------------------------------------------------------
function report(fid, target, prop, raw)
% setPropValue takes the RAW TYPED STRING (character vector) — exactly what our
% setProperty receives from a table cell edit. So we hand it `raw` verbatim and
% record MATLAB's outcome, which is the ground truth we mirror in TS.
try
    target.setPropValue(prop, raw);
    stored = target.getPropValue(prop);
    fprintf(fid, '  IN %-14s -> [OK] stored=%s [%s]\n', raw, scalarStr(stored), class(stored));
catch e
    fprintf(fid, '  IN %-14s -> [REJECT] %s\n', raw, oneline(e.message));
end
end

% ------------------------------------------------------------------------
function s = scalarStr(v)
if ischar(v)
    s = ['''' v ''''];
elseif isstring(v) && isscalar(v)
    s = ['"' char(v) '"'];
elseif (isnumeric(v) || islogical(v))
    s = mat2str(v);
else
    s = ['<' class(v) '>'];
end
end

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end
