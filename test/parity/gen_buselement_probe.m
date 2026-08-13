function gen_buselement_probe()
% What editable properties does a Simulink.BusElement actually have, and what
% are their constraints? Our table shows Name / DataType / Min / Max / Unit /
% Description columns for bus elements but they read empty — confirm which of
% those the object really supports, the exact property names, and the
% setPropValue constraints (so we mirror them the same way we did for
% Parameter/Signal).
%
% Run:  matlab -batch "cd('test/parity'); gen_buselement_probe"

here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'buselement_probe.txt'), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

be = Simulink.BusElement;

% 1) Full property list with current (default) values.
fprintf(fid, '==== Simulink.BusElement properties (name = default) ====\n');
mc = metaclass(be);
for k = 1:numel(mc.PropertyList)
    p = mc.PropertyList(k);
    if p.Hidden, continue; end
    nm = p.Name;
    try
        v = be.(nm);
        fprintf(fid, '  %-24s = %s [%s]  (SetAccess=%s)\n', nm, valStr(v), class(v), p.SetAccess);
    catch e
        fprintf(fid, '  %-24s = <unreadable: %s> (SetAccess=%s)\n', nm, regexprep(e.message,'\s+',' '), p.SetAccess);
    end
end

% 2) Does BusElement expose setPropValue at all (the DDG path)? Probe the same
%    Min/Max/Unit constraints if so; otherwise record dot-assignment behavior.
fprintf(fid, '\n==== setPropValue availability ====\n');
fprintf(fid, '  hasMethod setPropValue: %d\n', ismethod(be, 'setPropValue'));

% 3) Min / Max / Unit constraint sweep via direct assignment (what our editor
%    ultimately drives). Record accept/reject + the resulting stored value.
fprintf(fid, '\n==== Min / Max / Unit / DataType assignment sweep ====\n');
probeAssign(fid, 'Min',  {'5', '-3.5', '[]', '[5 6]', 'Inf', 'NaN', '5+2i', 'abc'});
probeAssign(fid, 'Max',  {'5', '-3.5', '[]', '[5 6]', 'Inf', 'NaN'});
probeAssign(fid, 'Unit', {'''m/s''', '''kg''', '''''', '[1 2]', '5'});
probeAssign(fid, 'DataType', {'''double''', '''int32''', '''single''', '''bogusType'''});

disp('buselement probe written');
end

% ------------------------------------------------------------------------
function probeAssign(fid, prop, inputs)
fprintf(fid, '  -- %s --\n', prop);
for ii = 1:numel(inputs)
    raw = inputs{ii};
    be = Simulink.BusElement;
    try
        v = eval(raw); %#ok<EVLCAY>
    catch e
        fprintf(fid, '    IN %-10s -> [PARSE-FAIL] %s\n', raw, regexprep(e.message,'\s+',' '));
        continue;
    end
    try
        be.(prop) = v;
        fprintf(fid, '    IN %-10s -> [OK] stored=%s [%s]\n', raw, valStr(be.(prop)), class(be.(prop)));
    catch e
        fprintf(fid, '    IN %-10s -> [REJECT] %s\n', raw, regexprep(e.message,'\s+',' '));
    end
end
end

% ------------------------------------------------------------------------
function s = valStr(v)
if ischar(v)
    s = ['''' v ''''];
elseif isstring(v) && isscalar(v)
    s = ['"' char(v) '"'];
elseif isnumeric(v) || islogical(v)
    if isempty(v), s = '[]'; else, s = mat2str(v); end
else
    s = ['<' class(v) '>'];
end
end
