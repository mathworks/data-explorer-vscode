function gen_minmax_cross_probe()
% Does MATLAB enforce Min <= Max on Simulink.Parameter/Signal? Our TS code
% rejects Min>Max; confirm MATLAB agrees before we keep that guard (we must not
% be STRICTER than MATLAB, or we'd block edits MATLAB accepts).
%
% Run:  matlab -batch "cd('test/parity'); gen_minmax_cross_probe"
here = fileparts(mfilename('fullpath'));
fid = fopen(fullfile(here, 'minmax_cross_probe.txt'), 'w');
c0 = onCleanup(@() fclose(fid)); %#ok<NASGU>

trials = { ...
    {'Min','5','Max','1'}, ...   % Min > Max
    {'Max','1','Min','5'}, ...   % set Max first then a larger Min
    {'Min','5','Max','5'} ...    % equal
};
for k = 1:numel(trials)
    t = trials{k};
    p = Simulink.Parameter(1.0);
    fprintf(fid, 'Parameter %s=%s then %s=%s -> ', t{1}, t{2}, t{3}, t{4});
    try
        p.setPropValue(t{1}, t{2});
        p.setPropValue(t{3}, t{4});
        fprintf(fid, '[OK] Min=%s Max=%s\n', p.getPropValue('Min'), p.getPropValue('Max'));
    catch e
        fprintf(fid, '[REJECT] %s\n', regexprep(e.message, '\s+', ' '));
    end
end
disp('done');
end
