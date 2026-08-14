function probe_enum(className, propName, candidatesCsv)
% Focused allowedValues discovery for a validated-string / enum property.
% Tries each candidate via the string-set path and reports accept/reject + the
% exact rejection message. Use this to nail the COMPLETE allowedValues set for
% enum/combobox props (Complexity, DimensionsMode, StorageClass, DataTypeMode,
% Signedness, ...), which the generic sweep only samples.
%
% Run:  mw matlab -nodesktop -batch "cd('test/parity/fidelity'); probe_enum('Simulink.Parameter','StorageClass','Auto,SimulinkGlobal,ExportedGlobal,ImportedExtern,ImportedExternPointer,Custom,Model default,bogus')"

cands = strsplit(candidatesCsv, ',');
here = fileparts(mfilename('fullpath'));
outDir = fullfile(here, 'out'); if ~exist(outDir,'dir'); mkdir(outDir); end
safe = [strrep(className,'.','_') '__' propName '__enum'];
fid = fopen(fullfile(outDir, [safe '.txt']), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

accepted = {};
fprintf(fid, '==== %s.%s allowedValues probe ====\n', className, propName);
for ii = 1:numel(cands)
    c = strtrim(cands{ii});
    obj = feval(className);
    try
        obj.(propName) = c;
        v = obj.(propName);
        accepted{end+1} = c; %#ok<AGROW>
        fprintf(fid, '  %-28s -> [OK] stored=%s\n', c, char(string(v)));
    catch e
        fprintf(fid, '  %-28s -> [REJECT] %s\n', c, regexprep(e.message,'\s+',' '));
    end
end
fprintf(fid, 'ACCEPTED: %s\n', strjoin(accepted, ', '));
fprintf('probe_enum %s.%s accepted: %s\n', className, propName, strjoin(accepted, ', '));
end
