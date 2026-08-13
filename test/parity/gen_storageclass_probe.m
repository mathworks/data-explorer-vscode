function gen_storageclass_probe()
% Is setting CoderInfo.StorageClass to each dropdown option safe (no error,
% no object corruption)? This is the only schema-projected prop we keep EDITABLE;
% Alignment and Unit fall back to read-only. Confirm every offered token applies.
%
% Run:  matlab -batch "cd('test/parity'); gen_storageclass_probe"
here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'storageclass_probe.txt'), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

opts = { 'Auto', 'SimulinkGlobal', 'ExportedGlobal', 'ImportedExtern', ...
         'ImportedExternPointer', 'Custom', 'Bogus' };
for k = 1:numel(opts)
    p = Simulink.Parameter(1.0);
    fprintf(fid, 'Parameter StorageClass=%-22s -> ', opts{k});
    try
        p.CoderInfo.StorageClass = opts{k};
        fprintf(fid, '[OK] stored=%s\n', p.CoderInfo.StorageClass);
    catch e
        fprintf(fid, '[REJECT] %s\n', regexprep(e.message, '\s+', ' '));
    end
end
disp('done');
end
