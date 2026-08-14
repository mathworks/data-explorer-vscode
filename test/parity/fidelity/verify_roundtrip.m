function verify_roundtrip(slddPath, entryName, specJson)
% Definitive UI->serializer->MATLAB-truth gate. Opens a .sldd our code produced,
% reads back the named entry, and asserts each expected property EQUALS what the
% UI set (value AND type) — not merely that the file opened.
%
% specJson: a JSON object mapping a property PATH to an expected value, e.g.
%   {"Min":5, "Value":[1,2,3], "CoderInfo.StorageClass":"ExportedGlobal",
%    "DataType":"int32", "__class__":"Simulink.Parameter", "__count__":3}
% Special keys: "__class__" asserts class(v); "__count__" asserts numel(v.Elements).
% A dotted path walks sub-objects (CoderInfo.StorageClass). String expecteds are
% compared with isequal after char() coercion; numeric with isequal (exact).
%
% Prints one line per assertion: "PASS <path>" or "FAIL <path> expected=.. got=..",
% then a final "RESULT PASS|FAIL n/m". Exit-style: the vitest caller greps RESULT.
%
% Run:  mw matlab -nodesktop -batch "cd('test/parity/fidelity'); verify_roundtrip('/tmp/x.sldd','MyParam','{\"Min\":5}')"

spec = jsondecode(specJson);
Simulink.data.dictionary.closeAll('-discard');
dd = Simulink.data.dictionary.open(slddPath);
c0 = onCleanup(@() safeClose(dd)); %#ok<NASGU>
sec = getSection(dd, 'Design Data');
e = getEntry(sec, entryName);
v = getValue(e);

keys = fieldnames(spec);
nPass = 0; nTot = 0;
for k = 1:numel(keys)
    key = keys{k};
    nTot = nTot + 1;
    % jsondecode mangles field names: any char that is not valid in a MATLAB
    % identifier becomes _0xHH_ (its hex code), and a leading underscore gets an
    % 'x' prefix. Undo BOTH generically so paths like "Elements(1).Min" (where
    % '.', '(' and ')' are all hex-escaped) resolve, not just the dot case.
    origKey = regexprep(key, '_0x([0-9A-Fa-f]{2})_', '${char(hex2dec($1))}');
    if strncmp(origKey, 'x__', 3); origKey = origKey(2:end); end
    expected = spec.(key);
    try
        if strcmp(origKey, '__class__')
            got = class(v); ok = strcmp(got, expected);
            report(origKey, ok, expected, got); nPass = nPass + ok;
        elseif strcmp(origKey, '__count__')
            got = numel(v.Elements); ok = isequal(got, expected);
            report(origKey, ok, num2str(expected), num2str(got)); nPass = nPass + ok;
        elseif strcmp(origKey, '__value__')
            % Compare the entry value directly (for plain variables where v IS
            % the value, not an object with properties).
            ok = compareVal(v, expected);
            report(origKey, ok, toStr(expected), toStr(v)); nPass = nPass + ok;
        else
            got = walkPath(v, origKey);
            ok = compareVal(got, expected);
            report(origKey, ok, toStr(expected), toStr(got)); nPass = nPass + ok;
        end
    catch err
        fprintf('FAIL %s (read error: %s)\n', origKey, regexprep(err.message,'\s+',' '));
    end
end
fprintf('RESULT %s %d/%d\n', ternary(nPass==nTot,'PASS','FAIL'), nPass, nTot);
end

function val = walkPath(v, path)
% Walk a dotted property path, with optional 1-based array indexing on any
% segment: "Elements(2).Name" reads v.Elements(2).Name. This lets a
% structural round-trip assert the value of a specific bus element / struct
% field after an add/remove.
parts = strsplit(path, '.');
val = v;
for i = 1:numel(parts)
    seg = parts{i};
    tok = regexp(seg, '^([A-Za-z_]\w*)\((\d+)\)$', 'tokens', 'once');
    if ~isempty(tok)
        val = val.(tok{1});
        val = val(str2double(tok{2}));
    else
        val = val.(seg);
    end
end
end

function ok = compareVal(got, expected)
if ischar(expected) || isstring(expected)
    ok = strcmp(char(string(got)), char(string(expected)));
elseif isnumeric(expected)
    ok = isequal(double(got), double(expected));
elseif islogical(expected)
    ok = isequal(logical(got), expected);
else
    ok = isequal(got, expected);
end
end

function report(key, ok, exp, got)
if ok
    fprintf('PASS %s\n', key);
else
    fprintf('FAIL %s expected=%s got=%s\n', key, exp, got);
end
end

function s = toStr(v)
if ischar(v); s = ['''' v ''''];
elseif isstring(v); s = char(v);
elseif isnumeric(v) || islogical(v); if isempty(v); s='[]'; else; s = mat2str(v); end
else; s = ['<' class(v) '>']; end
end

function r = ternary(c,a,b); if c; r=a; else; r=b; end; end
function safeClose(dd); try; close(dd); catch; end; end
