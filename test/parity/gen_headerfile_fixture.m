function gen_headerfile_fixture()
% GEN_HEADERFILE_FIXTURE  Capture a real .sldd whose entries carry a Header File
% code-gen attribute, so the schema `headerFile` column can be seeded + tested
% from the SERIALIZED shape (not just a live MCOS property).
%
% Header File is not a top-level property; it lives on the custom-storage-class
% attribute object CoderInfo.CustomAttributes, and only for file-based storage
% classes (ExportToFile / ImportFromFile / GetSet / Define / Volatile). This
% builds a Parameter and a Signal with CoderInfo.StorageClass='Custom',
% CustomStorageClass='ExportToFile', HeaderFile set to a distinctive value, and
% saves them into artifacts/{text,binary}/headerfile.sldd. A companion entry
% with a plain (Auto) storage class is included so the test can assert the
% column is BLANK when the attribute is absent.
%
% Run:  matlab -batch "cd('test/parity'); gen_headerfile_fixture"

here = fileparts(mfilename('fullpath'));
root = fullfile(here, 'artifacts');
probePath = fullfile(here, 'headerfile_probe.txt');
fid = fopen(probePath, 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

Simulink.data.dictionary.closeAll('-discard');

% ---- Entry WITH a Header File (ExportToFile custom storage class) ----
hp = Simulink.Parameter(3.14);
hp.DataType = 'double';
hp.Description = 'param with header file';
hp.CoderInfo.StorageClass = 'Custom';
hp.CoderInfo.CustomStorageClass = 'ExportToFile';
hp.CoderInfo.CustomAttributes.HeaderFile = 'params_hdr.h';

hs = Simulink.Signal;
hs.DataType = 'double';
hs.Description = 'signal with header file';
hs.CoderInfo.StorageClass = 'Custom';
hs.CoderInfo.CustomStorageClass = 'ExportToFile';
hs.CoderInfo.CustomAttributes.HeaderFile = 'signals_hdr.h';

% ---- Entry WITHOUT a Header File (plain Auto storage class) ----
plainP = Simulink.Parameter(1.0);
plainP.DataType = 'double';

fprintf(fid, '==== PROPERTY TREE: hdrParam (ExportToFile) ====\n');
dumpTree(fid, hp, '', 0);
fprintf(fid, '\n==== PROPERTY TREE: hdrSignal (ExportToFile) ====\n');
dumpTree(fid, hs, '', 0);
fprintf(fid, '\n==== PROPERTY TREE: plainParam (Auto) ====\n');
dumpTree(fid, plainP, '', 0);

saveVariant(fullfile(root, 'text'),   'uncompressed-text', hp, hs, plainP);
saveVariant(fullfile(root, 'binary'), 'compressed-binary', hp, hs, plainP);

disp('headerfile fixture generated.');
disp(['probe written to ' probePath]);
end

% ------------------------------------------------------------------------
function saveVariant(outDir, fmt, hp, hs, plainP)
if ~exist(outDir, 'dir'); mkdir(outDir); end
old = cd(outDir);
c = onCleanup(@() cd(old)); %#ok<NASGU>
if exist('headerfile.sldd', 'file'); delete('headerfile.sldd'); end
Simulink.data.dictionary.closeAll('-discard');
try
    dd = Simulink.data.dictionary.create('headerfile.sldd', 'FileFormat', fmt);
catch
    dd = Simulink.data.dictionary.create('headerfile.sldd');
end
sec = getSection(dd, 'Design Data');
sec.addEntry('hdrParam', hp);
sec.addEntry('hdrSignal', hs);
sec.addEntry('plainParam', plainP);
saveChanges(dd); close(dd);
end

% ------------------------------------------------------------------------
function dumpTree(fid, obj, prefix, depth)
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

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end
