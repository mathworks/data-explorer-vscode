function generate()
% GENERATE  Create a web of real MATLAB files for the dex-vsc parity check.
%
% Builds, under test/parity/artifacts/{text,binary}/, a web of real files that
% exercises (A) every cross-file relationship and (B) every data type the
% extension's parsers claim to handle (primitives + Simulink object types).
%
% The two output folders differ ONLY in the on-disk .sldd format:
%   text   -> dd.FileFormat = 'uncompressed-text'  (JSON)
%   binary -> dd.FileFormat = 'compressed-binary'   (ZIP)
%
% Ground truth (what MATLAB actually stored) is written to ground_truth.json.
% Entries are added defensively: each attempt is recorded as stored/failed, so
% types unsupported in a plain data dictionary are DOCUMENTED, not silently
% missing. The harness compares parser output to this file.

here = fileparts(mfilename('fullpath'));
root = fullfile(here, 'artifacts');

gt = struct();
gt.text   = buildVariant(fullfile(root, 'text'),   'uncompressed-text');
gt.binary = buildVariant(fullfile(root, 'binary'), 'compressed-binary');
gt.relationships = relationshipGroundTruth();
gt.paramUsage = paramUsageGroundTruth();

txt = jsonencode(gt, 'PrettyPrint', true);
fid = fopen(fullfile(here, 'ground_truth.json'), 'w');
fwrite(fid, txt);
fclose(fid);

disp('parity fixtures generated.');
end

% ========================================================================
function gt = buildVariant(outDir, fmt)
if exist(outDir, 'dir'); rmdir(outDir, 's'); end
mkdir(outDir);
old = cd(outDir);
c = onCleanup(@() cd(old)); %#ok<NASGU>

bdclose('all');
Simulink.data.dictionary.closeAll('-discard');

gt = struct();
gt.format = fmt;
gt.signals = buildSignalsMat(outDir);
gt.common  = buildCommonSldd(fmt);
gt.util    = buildUtilSldd(fmt);
gt.params  = buildParamsSldd(fmt);
buildSubModel(outDir);
buildPlantModel(outDir);
buildTopModel(outDir);

Simulink.data.dictionary.closeAll('-discard');
bdclose('all');
end

% ------------------------------------------------------------------------
function rec = buildSignalsMat(outDir)
% Plain MAT variables + a Simulink.Parameter (model->mat target & mat content).
Kp = 2.5;                                    %#ok<NASGU>
gainVec = [1 2 3];                           %#ok<NASGU>
offsetMat = [1 2; 3 4];                      %#ok<NASGU>
flag = true;                                 %#ok<NASGU>
label = 'signal-label';                      %#ok<NASGU>
matParam = Simulink.Parameter(7);
matParam.DataType = 'int32';                 %#ok<STRNU>
save(fullfile(outDir, 'signals.mat'), 'Kp', 'gainVec', 'offsetMat', ...
    'flag', 'label', 'matParam');
rec.vars = {'Kp','gainVec','offsetMat','flag','label','matParam'};
rec.values.Kp = 2.5;
rec.values.gainVec = [1 2 3];
rec.values.flag = true;
rec.values.label = 'signal-label';
end

% ------------------------------------------------------------------------
function rec = buildCommonSldd(fmt)
% Leaf dictionary (sldd->sldd target, chain tail).
dd = Simulink.data.dictionary.create('common.sldd');
sec = getSection(dd, 'Design Data');
rec = newRec();
rec = tryAdd(rec, sec, 'sharedGain', 4, 'double scalar');
rec = tryAdd(rec, sec, 'sharedOffset', Simulink.Parameter(1.5), 'Simulink.Parameter');
dd.FileFormat = fmt;
saveChanges(dd); close(dd);
end

% ------------------------------------------------------------------------
function rec = buildUtilSldd(fmt)
% Mid-chain dictionary: references common.sldd (depth-2 sldd chain).
dd = Simulink.data.dictionary.create('util.sldd');
addDataSource(dd, 'common.sldd');
sec = getSection(dd, 'Design Data');
rec = newRec();
rec = tryAdd(rec, sec, 'utilConst', 100, 'double scalar');
dd.FileFormat = fmt;
saveChanges(dd); close(dd);
end

% ------------------------------------------------------------------------
function rec = buildParamsSldd(fmt)
% The content dictionary: ALL data types. References common.sldd.
dd = Simulink.data.dictionary.create('params.sldd');
addDataSource(dd, 'common.sldd');
sec = getSection(dd, 'Design Data');
rec = newRec();

% --- Primitive / MATLAB numeric ---
rec = tryAdd(rec, sec, 'scalarD',   double(3.14),        'double scalar');
rec = tryAdd(rec, sec, 'sglScalar', single(2.5),         'single scalar');
rec = tryAdd(rec, sec, 'i8Scalar',  int8(-12),           'int8 scalar');
rec = tryAdd(rec, sec, 'i16Scalar', int16(-1234),        'int16 scalar');
rec = tryAdd(rec, sec, 'i32Scalar', int32(42),           'int32 scalar');
rec = tryAdd(rec, sec, 'u8Scalar',  uint8(200),          'uint8 scalar');
rec = tryAdd(rec, sec, 'u16Scalar', uint16(60000),       'uint16 scalar');
rec = tryAdd(rec, sec, 'u32Scalar', uint32(70000),       'uint32 scalar');
rec = tryAdd(rec, sec, 'boolFlag',  true,                'logical scalar');
rec = tryAdd(rec, sec, 'negD',      double(-9.5),        'negative double');

% --- Vectors / matrices ---
rec = tryAdd(rec, sec, 'rowVec',    [10 20 30 40],       'double row vector');
rec = tryAdd(rec, sec, 'colVec',    [1;2;3],             'double column vector');
rec = tryAdd(rec, sec, 'mat2x2',    [1 2; 3 4],          '2x2 double matrix');
rec = tryAdd(rec, sec, 'mat2x3',    [1 2 3; 4 5 6],      '2x3 double matrix');
rec = tryAdd(rec, sec, 'i32Vec',    int32([5 6 7]),      'int32 row vector');
rec = tryAdd(rec, sec, 'boolVec',   [true false true],   'logical vector');
rec = tryAdd(rec, sec, 'emptyD',    [],                  'empty double');

% --- Complex ---
rec = tryAdd(rec, sec, 'cplxScalar', 3+4i,               'complex scalar');
rec = tryAdd(rec, sec, 'cplxVec',    [1+1i, 2-2i],       'complex vector');

% --- Char / string ---
rec = tryAdd(rec, sec, 'charStr',   'hello',             'char row');
rec = tryAdd(rec, sec, 'strScalar', "worldString",       'string scalar');
rec = tryAdd(rec, sec, 'strArray',  ["a" "bb" "ccc"],    'string array');

% --- Struct / cell ---
st.a = 1; st.b = [2 3]; st.c = 'txt';
rec = tryAdd(rec, sec, 'myStruct',  st,                  'scalar struct');
nested.inner.x = 1; nested.inner.y = 2; nested.name = 'n';
rec = tryAdd(rec, sec, 'nestedStruct', nested,           'nested struct');
sarr(1).v = 1; sarr(2).v = 2;
rec = tryAdd(rec, sec, 'structArray', sarr,              'struct array');
rec = tryAdd(rec, sec, 'myCell',    {1, 'two', [3 4]},   'cell array');

% --- Simulink object types (CLASS_MAP coverage) ---
p = Simulink.Parameter(9.81);
p.DataType = 'double'; p.Min = 0; p.Max = 100; p.Unit = 'm/s^2';
p.Description = 'gravity accel';
rec = tryAdd(rec, sec, 'gravity', p, 'Simulink.Parameter');

pTyped = Simulink.Parameter(int16(5)); pTyped.DataType = 'int16';
rec = tryAdd(rec, sec, 'pInt16', pTyped, 'Simulink.Parameter int16');

sig = Simulink.Signal; sig.DataType = 'single'; sig.Min = -10; sig.Max = 10;
rec = tryAdd(rec, sec, 'sig1', sig, 'Simulink.Signal');

rec = tryAddFcn(rec, 'MyBus', 'Simulink.Bus', @() addBus(sec));
rec = tryAddFcn(rec, 'MyConnBus', 'Simulink.ConnectionBus', @() addConnBus(sec));

nt = Simulink.NumericType; nt.DataTypeMode = 'Fixed-point: binary point scaling';
nt.WordLength = 16; nt.FractionLength = 8;
rec = tryAdd(rec, sec, 'MyNumType', nt, 'Simulink.NumericType');

at = Simulink.AliasType; at.BaseType = 'int32';
rec = tryAdd(rec, sec, 'MyAlias', at, 'Simulink.AliasType');

rec = tryAddFcn(rec, 'MyValueType', 'Simulink.ValueType', @() addValueType(sec));
rec = tryAddFcn(rec, 'MyEnum', 'EnumTypeDefinition', @() addEnum(sec));

rec = tryAddFcn(rec, 'MyLUT', 'Simulink.LookupTable', @() addLUT(sec));
rec = tryAddFcn(rec, 'MyBkpt', 'Simulink.Breakpoint', @() addBkpt(sec));

% --- Variant family ---
rec = tryAddFcn(rec, 'MyVarCtrl', 'Simulink.VariantControl', @() addVariantControl(sec));
rec = tryAddFcn(rec, 'MyVarExpr', 'Simulink.VariantExpression', @() addVariantExpr(sec));
rec = tryAddFcn(rec, 'MyVarVar',  'Simulink.VariantVariable', @() addVariantVariable(sec));

dd.FileFormat = fmt;
saveChanges(dd); close(dd);

% Canonical content values for the table check (primitives only).
rec.values.scalarD   = 3.14;
rec.values.i32Scalar = 42;
rec.values.u8Scalar  = 200;
rec.values.boolFlag  = true;
rec.values.charStr   = 'hello';
rec.values.strScalar = 'worldString';
rec.values.rowVec    = [10 20 30 40];
rec.values.mat2x2    = [1 2; 3 4];
end

% ------------------------------------------------------------------------
% Helper record + defensive add
function rec = newRec()
rec.stored = {};    % names successfully added
rec.classes = struct();  % name -> intended type label
rec.failed = {};    % names that errored
rec.failReasons = struct();
rec.values = struct();
end

function rec = tryAdd(rec, sec, name, value, label)
try
    addEntry(sec, name, value);
    rec.stored{end+1} = name;
    rec.classes.(name) = label;
catch err
    rec.failed{end+1} = name;
    rec.failReasons.(name) = err.message;
end
end

function rec = tryAddFcn(rec, name, label, fcn)
% For object types that need multi-step construction; fcn does addEntry.
try
    fcn();
    rec.stored{end+1} = name;
    rec.classes.(name) = label;
catch err
    rec.failed{end+1} = name;
    rec.failReasons.(name) = err.message;
end
end

% ------------------------------------------------------------------------
% Object constructors that add themselves to the section
function addBus(sec)
els(1) = Simulink.BusElement; els(1).Name = 'x'; els(1).DataType = 'double';
els(2) = Simulink.BusElement; els(2).Name = 'y'; els(2).DataType = 'int32';
b = Simulink.Bus; b.Elements = els;
addEntry(sec, 'MyBus', b);
end

function addConnBus(sec)
cb = Simulink.ConnectionBus;
e = Simulink.ConnectionElement; e.Name = 'c1';
cb.Elements = e;
addEntry(sec, 'MyConnBus', cb);
end

function addValueType(sec)
vt = Simulink.ValueType; vt.DataType = 'double'; vt.Dimensions = 1;
vt.Unit = 'm';
addEntry(sec, 'MyValueType', vt);
end

function addEnum(sec)
defn = Simulink.data.dictionary.EnumTypeDefinition;
defn.appendEnumeral('Red', 0, 'red state');
defn.appendEnumeral('Green', 1, 'green state');
addEntry(sec, 'MyEnum', defn);
end

function addLUT(sec)
lut = Simulink.LookupTable;
lut.Table.Value = [1 2 3 4];
lut.Breakpoints(1).Value = [10 20 30 40];
addEntry(sec, 'MyLUT', lut);
end

function addBkpt(sec)
bk = Simulink.Breakpoint;
bk.Breakpoints.Value = [1 2 3];
addEntry(sec, 'MyBkpt', bk);
end

function addVariantControl(sec)
vc = Simulink.VariantControl('Value', 1, 'ActivationTime', 'update diagram');
addEntry(sec, 'MyVarCtrl', vc);
end

function addVariantExpr(sec)
ve = Simulink.VariantExpression('A == 1');
addEntry(sec, 'MyVarExpr', ve);
end

function addVariantVariable(sec)
vv = Simulink.VariantVariable( ...
    'Choices', {'A==1', 10, 'A==2', 20});
addEntry(sec, 'MyVarVar', vv);
end

% ------------------------------------------------------------------------
function buildPlantModel(outDir)
new_system('plant');
add_block('simulink/Sources/Constant', 'plant/PlantConst', 'Value', 'sharedGain');
add_block('built-in/Outport', 'plant/Out1');
add_line('plant', 'PlantConst/1', 'Out1/1');
% depth-2 model ref: plant references sub
add_block('simulink/Ports & Subsystems/Model', 'plant/SubRef', 'ModelName', 'sub');
save_system('plant', fullfile(outDir, 'plant.slx'));
close_system('plant');
end

function buildSubModel(outDir)
new_system('sub');
add_block('simulink/Sources/Constant', 'sub/K', 'Value', '1');
add_block('built-in/Outport', 'sub/Out1');
add_line('sub', 'K/1', 'Out1/1');
save_system('sub', fullfile(outDir, 'sub.slx'));
close_system('sub');
end

function buildTopModel(outDir)
new_system('top');
% param-usage: blocks reference named params by expression
add_block('simulink/Sources/Constant', 'top/C1', 'Value', 'scalarD');
add_block('simulink/Math Operations/Gain', 'top/G1', 'Gain', 'gravity');
add_block('simulink/Math Operations/Gain', 'top/G2', 'Gain', 'Kp');
add_line('top', 'C1/1', 'G1/1');
add_line('top', 'G1/1', 'G2/1');
% model -> model reference
add_block('simulink/Ports & Subsystems/Model', 'top/PlantRef', 'ModelName', 'plant');
% model -> sldd link
set_param('top', 'DataDictionary', 'params.sldd');
% model -> mat via model workspace
hws = get_param('top', 'ModelWorkspace');
hws.DataSource = 'MAT-File';
hws.FileName = 'signals.mat';
save_system('top', fullfile(outDir, 'top.slx'));
close_system('top', 0);   % discard model-workspace dirty flag; keep signals.mat pristine
end

% ========================================================================
function r = relationshipGroundTruth()
r.model_to_sldd  = { struct('model','top.slx','sldd','params.sldd') };
r.model_to_model = { struct('model','top.slx','ref','plant.slx'), ...
                     struct('model','plant.slx','ref','sub.slx') };
r.model_to_mat   = { struct('model','top.slx','mat','signals.mat') };
r.sldd_to_sldd   = { struct('sldd','params.sldd','ref','common.sldd'), ...
                     struct('sldd','util.sldd','ref','common.sldd') };
end

function u = paramUsageGroundTruth()
u = { struct('block','C1','property','Value','param','scalarD'), ...
      struct('block','G1','property','Gain','param','gravity'), ...
      struct('block','G2','property','Gain','param','Kp') };
end
