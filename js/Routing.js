/* global ol, Graph, $ */

/**
 * Routing
 * 
 * @class
 */
var Routing = function(app) {

    /**
     *
     */
    this.app = app;
    
    /**
     * Le graphe utilisé
     * @type {Graph}
     */
    this.graph = undefined;

    /**
     * Array contenant la position x, y de chacun des noeuds.
     * La clé est l'identifiant du noeud (.source / .target dans routing.json)
     * @type {Array.<Number, Array.<Number, Number>>}
     */
    this.geomNodes = [];

    /**
     * Array contenant les données géometrique des arcs nécessaire pour l'affichage.
     * La clé est l'identifiant de l'arc (.gid dans routing.json)
     * @type {Array.<Number, Array.<Number, Number, ol.format.WKT>>}
     */
    this.geomRoutes = [];

    /**
     * Permet de savoir rapidement depuis l'application si un object se trouve dans le graphe ou pas
     * Par exemple les lignes de tram ou train ne le sont pas.
     * La clé est un identifiant OSM
     * @type {Array.<Number, boolean>}
     */
    this.isRouting = [];
    
};

/**
 * Lecture du fichier routing et création du graphe
 * @param {string} file json file contenant les informations sur le graphe (format PGrouting)
 */
Routing.prototype.init = function(file) {

    this.graph = new Graph;

    var d = $.Deferred();

    var that = this;

    $.getJSON(file).done(function(result) {

        $.each(result, function(i, field) {

            var source = parseInt(field.source);
            var target = parseInt(field.target);
            var length = parseFloat(field.length);
            var gid = parseInt(field.gid);
            var x1 = parseFloat(field.x1);
            var x2 = parseFloat(field.x2);
            var y1 = parseFloat(field.y1);
            var y2 = parseFloat(field.y2);
            var osm_id = parseInt(field.osm_id);
            
            // On remplis notre graph pour appliquer les differents algorithmes nécessaire
            that.graph.addNode(source);
            that.graph.addNode(target);
            // Le graph est orienté, mais nos routes ne le sont pas.
            that.graph.addEdge(source, target, length, gid);
            that.graph.addEdge(target, source, length, gid);
            
            // on enregistre les données géométrique nous intéressant pour l'affichage
            that.geomNodes[source] = [x1, y1];
            that.geomNodes[target] = [x2, y2];

            that.geomRoutes[gid] = [source, target, field.geom, osm_id, length];

            that.isRouting[osm_id] = true;
            
        });

        d.resolve();

    });

    return d.promise();
};

/**
 * Implémentation de l'algorithme de dijkstra
 * @param {Number} start noeud de depart
 * @param {Number} stop noeud d'arrivé
 * @returns {Number[]} Chemin représenté par une liste d'identifiant des ARCS. Ces identifiant doivent existé en tant que clé du tableau geomRoutes
 */
Routing.prototype.dijkstra = function(start, stop) {

    var validatedNodes = [];
    var visitedNodes = [];

    visitedNodes[start] = {
        'dst' : 0,
        'father' : null,
        'path' : null
    };

    do {
        if( Object.keys(visitedNodes).length == 0){
            return [];
        }
        var selectedNode;
        var dst = Infinity;

        for (var node in visitedNodes) {
            if (visitedNodes[node].dst < dst) {
                selectedNode = node;
                dst = visitedNodes[node].dst;
            }
        }

        var neighbors = this.graph.getNode(selectedNode)._outEdges;

        for (var neighbor in neighbors) {
            
            if (neighbor in validatedNodes) {
                continue;
            }
            
            dst = visitedNodes[selectedNode].dst + neighbors[neighbor].weight;

            if (!(neighbor in visitedNodes)) {

                visitedNodes[neighbor] = {
                    'dst' : dst,
                    'father' : selectedNode,
                    'path' : neighbors[neighbor].gid
                };
            } else if (visitedNodes[neighbor].dst > dst) {
                visitedNodes[neighbor] = {
                    'dst' : dst,
                    'father' : selectedNode,
                    'path' : neighbors[neighbor].gid
                };
            }

        }
        validatedNodes[selectedNode] = visitedNodes[selectedNode];
        delete visitedNodes[selectedNode];

    } while (selectedNode != stop);

    var path = [];
    selectedNode = stop;
    
    do {
        path.unshift(validatedNodes[selectedNode].path);
        selectedNode = validatedNodes[selectedNode].father;

    } while(validatedNodes[selectedNode].father != null);

    return path;
};


Routing.prototype.osmFeatureToEdge = function(feature, c) {

    // liste des arcs possible où C peut se trouver
    var edges = this.getEdgesFromOsmId(parseInt(feature.get('osm_id')));

    for (var e of edges) {

        var f = (new ol.format.WKT()).readFeature(e[2], this.app.to3857).getGeometry().getCoordinates();

        // on prend les segments un par un
        for (var i = 0; i < (f.length - 1); i++) {

            var a = f[i];
            var b = f[i + 1];

            // produit croisé pour voir si les segments sont colinéaires
            var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

            // produit scalaire
            var dot = (c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1]);

            // distance entre A et C
            var dAC = Math.sqrt( (a[0] - c[0]) * (a[0] - c[0]) + (a[1] - c[1]) * (a[1] - c[1]) );

            // distance entre A et B
            var dAB = Math.sqrt( (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) );

            // distance entre B et C
            var dBC = Math.sqrt( (b[0] - c[0]) * (b[0] - c[0]) + (b[1] - c[1]) * (b[1] - c[1]) );


            // Si les segments sont colinéaire et que C se trouve entre A et B au niveau des distances
            if ( Math.abs(cross) < 10.0 && (dAC <= dAB + 1.0 && dBC <= dAB + 1.0) ) {
                return e;
            }
        }
    }

    return edges[0];
    
};

/**
 *
 */
Routing.prototype.getEdgesFromOsmId = function(osmId) {
    var edges = [];

    for (var e in this.geomRoutes) {

        if (this.geomRoutes[e][3] == osmId) {
            edges.push(this.geomRoutes[e]);
        }
    }

    
    return edges;
};

/**
 *  Sépare un arc du graphe en deux arc à partir du noeud
 */
Routing.prototype.splitEdge = function(node, edge) {

    var f = (new ol.format.WKT()).readFeature(edge[2], this.app.to3857).getGeometry().getCoordinates();

    var c = node;

    var edge1Geom = [];
    var edge2Geom = [];

    var foundNode = false;

    edge1Geom.push(f[0]);
    
    // on prend les segments un par un
    for (var i = 0; i < f.length - 1; i++) {

        var a = f[i];
        var b = f[i + 1];

        // produit croisé pour voir si les segments sont colinéaires
        var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

        // produit scalaire
        var dot = (c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1]);

        // distance entre A et C
        var dAC = Math.sqrt( (a[0] - c[0]) * (a[0] - c[0]) + (a[1] - c[1]) * (a[1] - c[1]) );

        // distance entre A et B
        var dAB = Math.sqrt( (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) );

        // distance entre B et C
        var dBC = Math.sqrt( (b[0] - c[0]) * (b[0] - c[0]) + (b[1] - c[1]) * (b[1] - c[1]) );

        // Si les segments sont colinéaire et que C se trouve entre A et B au niveau des distances
        if ( Math.abs(cross) < 10 && (dAC < dAB && dBC < dAB) ) {

            foundNode = true;
            
            edge1Geom.push(f[i]);
            edge1Geom.push(c);
            edge2Geom.push(c);
            
        }

        if (!foundNode) {

            edge1Geom.push(f[i + 1]);

        } else {

            edge2Geom.push(f[i + 1]);

        }
    }

    var wkt1 = (new ol.format.WKT()).writeFeature(new ol.Feature(new ol.geom.LineString(edge1Geom)), this.app.to3857);

    var wkt2 = (new ol.format.WKT()).writeFeature(new ol.Feature(new ol.geom.LineString(edge2Geom)), this.app.to3857);
    
    //[field.source, field.target, field.geom, field.osm_id];
    var edge1 = [edge[0] + '/' + edge[1], edge[0], wkt1, edge[3]];
    var edge2 = [edge[0] + '/' + edge[1], edge[1], wkt2, edge[3]];
    
    return [edge1, edge2];
};

/**
 *
 */
Routing.prototype.getRouteLength = function(route) {

    var totalLength = 0;

    for (var e of route) {
        totalLength += this.geomRoutes[e][4];
    }

    return totalLength;
};

/*
 * Récupére les informations géometriques d'une route.
 * @param {Number[]} route liste d'arcs du graph decrivant la route à afficher
 * @returns {ol.Feature[]} Liste d'openlayers3 features.
 */
Routing.prototype.getGeometryFromRoute = function(route) {

    var features = [];
    var x1, y1;
    var routeGeom, edge;
    
    for (var i = 0; i < (route.length); i++) {

        edge = this.geomRoutes[route[i]];

        x1 = this.geomNodes[edge[0]][0];
        y1 = this.geomNodes[edge[0]][1];

        features.push(new ol.Feature({
            'geometry': new ol.geom.Point(
                ol.proj.transform([x1, y1], 'EPSG:4326', 'EPSG:3857'))
        }));

        routeGeom = edge[2];

        var f = (new ol.format.WKT()).readFeature(routeGeom);

        f.setGeometry(f.getGeometry().transform('EPSG:4326', 'EPSG:3857'));

        features.push(f);
    }

    return features;
};





