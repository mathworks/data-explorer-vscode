function gen_element_fixture()
% Build fully-populated bus/connection/service interfaces with their ELEMENT
% properties set, dump each object's property tree, and save text+binary .sldd
% fixtures. A companion Node step then reads the saved dictionaries to reveal
% the exact SERIALIZED key names for element properties (Min vs Min_internal,
% DataType vs DataType_internal, Unit vs DocUnits, Type vs Type_internal) — the
% ground truth for why the element columns render empty.
%
% Run:  matlab -batch "cd('test/parity'); gen_element_fixture"

here = fileparts(mfilename('fullpath'));
root = fullfile(here, 'artifacts');
fid = fopen(fullfile(here, 'element_probe.txt'), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

Simulink.data.dictionary.closeAll('-discard');

% ---- Simulink.Bus with a fully populated BusElement -------------------
be = Simulink.BusElement;
be.Name = 'x';
be.DataType = 'int32';
be.Min = -5;
be.Max = 10;
be.Unit = 'm/s';
be.Dimensions = 2;
be.Complexity = 'complex';
be.DimensionsMode = 'Fixed';
be.Description = 'a populated element';
be2 = Simulink.BusElement; be2.Name = 'y';  % a default (empty) element
bus = Simulink.Bus; bus.Elements = [be be2];
fprintf(fid, '==== Simulink.Bus (live object) ====\n');
dumpTree(fid, bus, '', 0);

% ---- Simulink.ConnectionBus with a ConnectionElement ------------------
cbOk = true;
try
    ce = Simulink.ConnectionElement; ce.Name = 'c1';
    dumpElemProps(fid, 'Simulink.ConnectionElement (live)', ce);
    cb = Simulink.ConnectionBus; cb.Elements = ce;
catch e
    cbOk = false;
    fprintf(fid, 'ConnectionBus build failed: %s\n', oneline(e.message));
end

% ---- Simulink.ServiceBus with a FunctionElement -----------------------
sbOk = true;
try
    fe = Simulink.FunctionElement;
    dumpElemProps(fid, 'Simulink.FunctionElement (live)', fe);
    sb = Simulink.ServiceBus;
    try, sb.addElement(fe); catch, try, sb.Elements = fe; catch ee, fprintf(fid,'SB set elem: %s\n', oneline(ee.message)); end, end
catch e
    sbOk = false;
    fprintf(fid, 'ServiceBus build failed: %s\n', oneline(e.message));
end

% ---- Save fixtures (text + binary) ------------------------------------
saveVariant(fullfile(root, 'elem_text'),   'uncompressed-text', bus, cbOk, cb, sbOk, sb);
saveVariant(fullfile(root, 'elem_binary'), 'compressed-binary', bus, cbOk, cb, sbOk, sb);

disp('element fixture + probe written');
end

% ------------------------------------------------------------------------
function dumpElemProps(fid, title, obj)
fprintf(fid, '\n==== %s ====\n', title);
mc = metaclass(obj);
for k = 1:numel(mc.PropertyList)
    p = mc.PropertyList(k);
    if p.Hidden, continue; end
    try
        v = obj.(p.Name);
        fprintf(fid, '  %-22s = %s [%s] (SetAccess=%s)\n', p.Name, valStr(v), class(v), p.SetAccess);
    catch
        fprintf(fid, '  %-22s = <unreadable> (SetAccess=%s)\n', p.Name, p.SetAccess);
    end
end
end

% ------------------------------------------------------------------------
function saveVariant(outDir, fmt, bus, cbOk, cb, sbOk, sb)
if ~exist(outDir, 'dir'); mkdir(outDir); end
old = cd(outDir); c = onCleanup(@() cd(old)); %#ok<NASGU>
if exist('elements.sldd', 'file'); delete('elements.sldd'); end
Simulink.data.dictionary.closeAll('-discard');
try
    dd = Simulink.data.dictionary.create('elements.sldd', 'FileFormat', fmt);
catch
    dd = Simulink.data.dictionary.create('elements.sldd');
end
sec = getSection(dd, 'Design Data');
sec.addEntry('MyBus', bus);
if cbOk, try, sec.addEntry('MyConnBus', cb); catch, end, end
if sbOk, try, sec.addEntry('MyServiceBus', sb); catch, end, end
saveChanges(dd); close(dd);
end

% ------------------------------------------------------------------------
function dumpTree(fid, obj, prefix, depth)
if depth > 6, return; end
mc = metaclass(obj);
if isempty(mc)
    fprintf(fid, '%s= %s [%s]\n', prefix, valStr(obj), class(obj));
    return;
end
for k = 1:numel(mc.PropertyList)
    p = mc.PropertyList(k);
    if p.Hidden, continue; end
    path = [prefix '.' p.Name];
    try
        v = obj.(p.Name);
    catch
        fprintf(fid, '%s = <unreadable>\n', path);
        continue;
    end
    if isobject(v) && ~isenum(v)
        if numel(v) > 1
            for j = 1:numel(v)
                dumpTree(fid, v(j), sprintf('%s(%d)', path, j), depth + 1);
            end
        else
            fprintf(fid, '%s [%s]\n', path, class(v));
            dumpTree(fid, v, path, depth + 1);
        end
    else
        fprintf(fid, '%s = %s [%s]\n', path, valStr(v), class(v));
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

function s = oneline(s)
s = regexprep(s, '\s+', ' ');
end
