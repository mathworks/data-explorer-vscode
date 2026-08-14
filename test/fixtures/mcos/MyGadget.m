classdef MyGadget
  properties
    Wheels = 6
    Name = 'Model-X'          % char (round-trips reliably)
    Engine = MyEngine.empty   % nested custom object
    Specs = struct('mass', 2200, 'color', 'blue')
    Tags = {'suv', 'electric'}
  end
end
