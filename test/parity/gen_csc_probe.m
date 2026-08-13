function gen_csc_probe()
% GEN_CSC_PROBE  Find the real source path for Data Scope + Header File.
%
% Earlier probing with the DEFAULT storage class found DataScope/HeaderFile
% absent. They are attributes of certain CUSTOM storage classes, exposed via
% CoderInfo.CustomAttributes. This script sweeps candidate custom storage
% classes and dumps the CustomAttributes property list + values for each, so
% the schema source path is seeded from real data.
%
% Run:  matlab -batch "cd('test/parity'); gen_csc_probe"

here = fileparts(mfilename('fullpath'));
probePath = fullfile(here, 'csc_probe.txt');
fid = fopen(probePath, 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

Simulink.data.dictionary.closeAll('-discard');

cscs = {'ExportToFile', 'ImportFromFile', 'ExportedGlobal', 'ImportedExtern', ...
        'ImportedExternPointer', 'BitField', 'Struct', 'GetSet', 'Define', 'Volatile'};

fprintf(fid, '==== Simulink.Parameter: CustomStorageClass sweep ====\n');
sweep(fid, @() Simulink.Parameter(1), cscs);
fprintf(fid, '\n==== Simulink.Signal: CustomStorageClass sweep ====\n');
sweep(fid, @() Simulink.Signal, cscs);

disp('csc probe written to');
disp(probePath);
end

% ------------------------------------------------------------------------
function sweep(fid, ctor, cscs)
for i = 1:numel(cscs)
    name = cscs{i};
    obj = ctor();
    obj.DataType = 'double';
    ok = true; err = '';
    try
        obj.CoderInfo.StorageClass = 'Custom';
        obj.CoderInfo.CustomStorageClass = name;
    catch e
        ok = false; err = oneline(e.message);
    end
    if ~ok
        fprintf(fid, '\n  CSC=%s  [set FAILED: %s]\n', name, err);
        continue;
    end
    ca = [];
    try
        ca = obj.CoderInfo.CustomAttributes;
    catch e
        fprintf(fid, '\n  CSC=%s  CustomAttributes unreadable: %s\n', name, oneline(e.message));
        continue;
    end
    fprintf(fid, '\n  CSC=%s  CustomAttributes class=<%s>\n', name, class(ca));
    props = {};
    try; props = properties(ca); catch; end
    for j = 1:numel(props)
        p = props{j};
        try
            v = ca.(p);
            fprintf(fid, '      %s = %s  [%s]\n', p, scalarStr(v), class(v));
        catch e
            fprintf(fid, '      %s = <unreadable: %s>\n', p, oneline(e.message));
        end
    end
    % Explicitly report whether the two properties of interest are present.
    fprintf(fid, '      -> has DataScope:  %d\n', any(strcmp(props, 'DataScope')));
    fprintf(fid, '      -> has HeaderFile: %d\n', any(strcmp(props, 'HeaderFile')));
end
end

function s = scalarStr(v)
if ischar(v)
    s = ['''' v ''''];
elseif isstring(v) && isscalar(v)
    s = ['"' char(v) '"'];
elseif (isnumeric(v) || islogical(v)) && isscalar(v)
    s = mat2str(v);
elseif (isnumeric(v) || islogical(v))
    s = mat2str(v);
else
    s = ['<' class(v) '>'];
end
end

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end
