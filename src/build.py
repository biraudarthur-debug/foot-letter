# Reconstruit index.html à partir du modèle et de la liste de joueurs.
import pathlib
root = pathlib.Path(__file__).resolve().parent
html = (root / "index.template.html").read_text(encoding="utf8")
players = (root / "players.txt").read_text(encoding="utf8")
(root.parent / "index.html").write_text(html.replace("/*PLAYERS*/", players), encoding="utf8")
print("index.html reconstruit")
