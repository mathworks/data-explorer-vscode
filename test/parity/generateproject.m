function generateproject()
% GENERATEPROJECT  Create real MATLAB Project fixtures for the dex-vsc parity check.
%
% Builds, under test/parity/artifacts/project/ :
%   MyProj/     - main project: member files (slx, m, folders), a path folder,
%                 file labels (built-in + a custom category), a startup file,
%                 and a project->project reference to LibProj.
%   LibProj/    - referenced library project (reference target).
%
% Writes project_ground_truth.json capturing what MATLAB actually stored, so the
% parser can be compared to the script setup rather than eyeballed.

here = fileparts(mfilename('fullpath'));
outRoot = fullfile(here, 'artifacts', 'project');
if exist(outRoot, 'dir'); rmdir(outRoot, 's'); end
mkdir(outRoot);

% --- LibProj: the referenced library project --------------------------
libRoot = fullfile(outRoot, 'LibProj');
mkdir(libRoot);
lib = matlab.project.createProject('Name', 'LibProj', 'Folder', libRoot);
ldir = fullfile(libRoot, 'lib'); mkdir(ldir);
fid = fopen(fullfile(ldir, 'libfun.m'), 'w'); fwrite(fid, 'function y=libfun(x); y=2*x; end'); fclose(fid);
addFile(lib, fullfile(ldir, 'libfun.m'));
close(lib);

% --- MyProj: the main project -----------------------------------------
projRoot = fullfile(outRoot, 'MyProj');
mkdir(projRoot);
proj = matlab.project.createProject('Name', 'MyProj', 'Folder', projRoot);

% member model
mdir = fullfile(projRoot, 'models'); mkdir(mdir);
bdclose('all');
new_system('projmodel');
save_system('projmodel', fullfile(mdir, 'projmodel.slx'));
close_system('projmodel');
addFile(proj, fullfile(mdir, 'projmodel.slx'));

% member utility + path folder
udir = fullfile(projRoot, 'utils'); mkdir(udir);
fid = fopen(fullfile(udir, 'helper.m'), 'w'); fwrite(fid, 'function y=helper(x); y=x+1; end'); fclose(fid);
addFile(proj, fullfile(udir, 'helper.m'));
addPath(proj, udir);

% startup file
fid = fopen(fullfile(projRoot, 'startup.m'), 'w'); fwrite(fid, 'disp(''startup'')'); fclose(fid);
addStartupFile(proj, fullfile(projRoot, 'startup.m'));

% labels: built-in classification (auto) + a custom category.
% createLabel is a method on the Category object, not on Project.
cat = createCategory(proj, 'Status', 'char');
cat.createLabel('Reviewed');
mdlFile = findFile(proj, fullfile(mdir, 'projmodel.slx'));
addLabel(proj, mdlFile, 'Status', 'Reviewed');

% project -> project reference
addReference(proj, libRoot, 'relative');

close(proj);

% --- ground truth ------------------------------------------------------
gt = struct();
gt.name = 'MyProj';
gt.files = { 'models', 'projmodel.slx', 'utils', 'helper.m', 'startup.m' };
gt.pathFolders = { 'utils' };
gt.labels = { struct('file', 'projmodel.slx', 'category', 'Status', 'name', 'Reviewed') };
gt.references = { 'LibProj' };
gt.startupFiles = { 'startup.m' };

txt = jsonencode(gt, 'PrettyPrint', true);
fid = fopen(fullfile(here, 'project_ground_truth.json'), 'w');
fwrite(fid, txt);
fclose(fid);

disp('project fixtures generated.');
end
