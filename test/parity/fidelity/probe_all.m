function probe_all()
% Batch-probe every Simulink data-object class we model, in ONE MATLAB session
% (amortizes startup). Writes out/<Class>.json + .txt per class via probe_class.
% Classes that fail to construct are recorded (constructed=false) rather than
% aborting the batch.
%
% Run:  mw matlab -nodesktop -batch "cd('test/parity/fidelity'); probe_all"

classes = {
    'Simulink.Parameter'
    'Simulink.Signal'
    'Simulink.BusElement'
    'Simulink.Bus'
    'Simulink.ConnectionBus'
    'Simulink.ConnectionElement'
    'Simulink.ServiceBus'
    'Simulink.FunctionElement'
    'Simulink.NumericType'
    'Simulink.AliasType'
    'Simulink.ValueType'
    'Simulink.LookupTable'
    'Simulink.Breakpoint'
    'Simulink.VariantExpression'
    'Simulink.VariantControl'
    'Simulink.VariantVariable'
    'Simulink.VariantBank'
    'Simulink.VariantConfigurationData'
    'Simulink.ConfigSet'
};
for k = 1:numel(classes)
    cn = classes{k};
    try
        probe_class(cn);
    catch e
        fprintf('PROBE FAILED %s: %s\n', cn, regexprep(e.message,'\s+',' '));
    end
end
disp('probe_all done');
end
