"""Felsen (mit LOD-Stufen für die Fernsicht). Bäume und Büsche: trees.py."""
import math

from lib import join, rock, smooth, tube


def rock_large():
    parts = [rock("rock", 1.9, 501, loc=(0, 0, 0.7), scale=(1.1, 0.95, 0.8))]
    parts.append(rock("rock2", 0.9, 502, loc=(1.5, 0.8, 0.2), scale=(1, 1, 0.7)))
    o = join(parts, "rock_large")
    smooth(o, 40)
    return o


def rock_small():
    o = join([rock("rock", 0.8, 511, loc=(0, 0, 0.3), scale=(1.1, 1.0, 0.75))], "rock_small")
    smooth(o, 40)
    return o


def cliff_rock():
    parts = [rock("cliff", 3.6, 521, loc=(0, 0, 3.2), scale=(1.1, 0.9, 1.35))]
    parts.append(rock("cliff2", 2.6, 522, loc=(1.8, 1.2, 6.2), scale=(1.0, 0.9, 1.0)))
    parts.append(rock("cliff3", 2.2, 523, loc=(-2.4, -0.8, 1.0), scale=(1.1, 1.1, 0.8)))
    o = join(parts, "cliff_rock")
    smooth(o, 35)
    return o


ASSETS = {
    "rock_large": (rock_large, 0.3), "rock_small": (rock_small, 0.4), "cliff_rock": (cliff_rock, 0.3),
}
