function gen_buselement_constraints_probe()
% Constraints for the BusElement properties we intend to surface as columns:
% Dimensions, Complexity, DimensionsMode, DataType. Drives direct assignment
% (what our editor path ultimately does) with valid + invalid typed text and
% records accept/reject + stored value + exact error. Ground truth for deciding
% which are safely editable vs conservatively read-only.
%
% Run:  matlab -batch "cd('test/parity'); gen_buselement_constraints_probe"
here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'buselement_constraints_probe.txt'), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

probe(fid, 'Complexity',     {'''real''', '''complex''', '''auto''', '''bogus''', '5'});
probe(fid, 'Dimensions',     {'1', '2', '[1 3]', '[2 2]', '-1', '0', '1.5', 'Inf', '''x'''});
probe(fid, 'DimensionsMode', {'''Fixed''', '''Variable''', '''auto''', '''bogus'''});
probe(fid, 'DataType',       {'''double''', '''int32''', '''boolean''', '''bogusType''', '''Enum: X''', '5', '[1 2]'});
probe(fid, 'SampleTime',     {'-1', '0', '0.1', '[1 2]', 'Inf', '''x'''});
probe(fid, 'SamplingMode',   {'''Sample based''', '''Frame based''', '''bogus'''});

disp('buselement constraints probe written');
end

function probe(fid, prop, inputs)
fprintf(fid, '\n==== Simulink.BusElement.%s ====\n', prop);
for ii = 1:numel(inputs)
    raw = inputs{ii};
    be = Simulink.BusElement;
    try
        v = eval(raw); %#ok<EVLCAY>
    catch e
        fprintf(fid, '  IN %-14s -> [PARSE-FAIL] %s\n', raw, regexprep(e.message,'\s+',' '));
        continue;
    end
    try
        be.(prop) = v;
        fprintf(fid, '  IN %-14s -> [OK] stored=%s [%s]\n', raw, valStr(be.(prop)), class(be.(prop)));
    catch e
        fprintf(fid, '  IN %-14s -> [REJECT] %s\n', raw, regexprep(e.message,'\s+',' '));
    end
end
end

function s = valStr(v)
if ischar(v)
    s = ['''' v ''''];
elseif isnumeric(v) || islogical(v)
    if isempty(v), s = '[]'; else, s = mat2str(v); end
else
    s = ['<' class(v) '>'];
end
end
