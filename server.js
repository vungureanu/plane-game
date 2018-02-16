var app = require("express")();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var THREE = require("three");
var players = {};
const radius = 100;
const REFRESH_TIME = 100; // Milliseconds between successive refreshes
const SCENE = new THREE.Scene();
const TRAIL_LENGTH = 100;
const SPEED = 0.3;
var trail = [];
var cur_id = 0;

http.listen(3000, function(){
	console.log('listening on *:3000');
});

app.get("/", function(req, res) {
	res.sendFile(__dirname + "/index.html");
});
app.get("/js/three.js", function(req, res) {
	res.sendFile(__dirname + "/js/three.js");
});

function create_new_player() {
	var r = Math.random() * radius / 2 + radius / 4;
	var theta = Math.random() * Math.PI;
	var phi = Math.random() * Math.PI - Math.PI / 2;
	var new_player = {
		plane : draw_plane(),
		x_frac : 0,
		y_frac : 0,
		turn : 0,
		trail : [],
		trail_index : 0,
		id : cur_id,
		plane_container : new THREE.Group(),
	};
	new_player.plane_container.add(new_player.plane);
	new_player.plane_container.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	return new_player;
}

function update_world() {
	for ( var id in players ) {
		update_location(players[id]);
		send_location(players[id]);
	}
}

setInterval(update_world, REFRESH_TIME);

/* SOCKET */

function update_location( player ) {
	player.plane_container.rotateY(-player.x_frac * SPEED);
	player.plane_container.rotateX(player.y_frac * SPEED);
	player.plane.rotateZ(player.turn * SPEED);
	player.plane_container.translateZ(SPEED);
	update_trail(player);
}

function send_location( player ) {
	io.emit("update", {
		id : player.id, 
		pos : player.plane_container.getWorldPosition(),
		outer_rot : player.plane_container.rotation,
		inner_rot : player.plane.rotation,
		trail : player.trail[player.trail_index]
	});
}

io.on("connection", function(socket) {
	var new_player = create_new_player();
	socket.emit("id", new_player.id);
	socket.broadcast.emit("add", {
		id : new_player.id,
		pos : new_player.plane_container.position,
		outer_rot : new_player.plane_container.rotation,
		inner_rot : new_player.plane.rotation
	});
	for (var id in players) {
		socket.emit("add", {
			id : players[id].id,
			pos : players[id].plane_container.getWorldPosition(),
			outer_rot : players[id].plane_container.rotation,
			inner_rot : players[id].plane.rotation
		});
	}
	socket.on("status", function(status) {
		if ( status.id in players ) {
			players[status.id].x_frac = status.x_frac;
			players[status.id].y_frac = status.y_frac;
			players[status.id].turn = status.turn;
		}
		else {
			console.log("Missing:", status);
		}
	});
	players[cur_id] = new_player;
	cur_id += 1;
});

/* GRAPHICS */

function draw_plane() {
	var plane = new THREE.Group();
	plane.name = "plane";
	var geometry = new THREE.SphereGeometry( 1, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff0000} );
	var left_guide = new THREE.Mesh( geometry, material );
	left_guide.name = "left guide";
	var right_guide = new THREE.Mesh( geometry, material );
	right_guide.name = "right guide";
	left_guide.position.set( 5, 0, 0 );
	right_guide.position.set( -5, 0, 0 );
	plane.add(left_guide);
	plane.add(right_guide);
	left_guide.old_coords = left_guide.getWorldPosition();
	right_guide.old_coords = right_guide.getWorldPosition();
	SCENE.add(plane);
	return plane;
}

function update_trail( player ) {
	left_guide = player.plane.getObjectByName("left guide");
	right_guide = player.plane.getObjectByName("right guide");
	var new_left = left_guide.getWorldPosition();
	var new_right = right_guide.getWorldPosition();
	player.trail_index = (player.trail_index + 1) % TRAIL_LENGTH;
	player.trail[player.trail_index] = { left : new_left, right : new_right }
}

/* INTERSECTION DETECTION */

function intersects( rec, box ) {
	if (rec.v1.distanceToSquared(box.v1) > 400) {
		return false;
	}
}