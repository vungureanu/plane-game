const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer( {canvas : document.getElementById("main_screen")} );
var frac = 19 / 20;
var game_height = window.innerHeight * frac;
renderer.setSize( window.innerWidth, game_height );
const gas_bar = document.getElementById("gasBar");
var socket = io();
const trail_material = new THREE.MeshBasicMaterial({
		color: 0x0000ff,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
var trail_length;
const SEND_INTERVAL = 100; // Milliseconds between successive send operations
var outer_radius;
var inner_radius;
var initial_gas;
// Distance of mouse away from center, as fraction of the canvas's width or height
var x_frac = 0;
var y_frac = 0;
var players = new Map(); // State (spatial coordinates and orientation) of all other players
var click = false; // Whether mouse is depressed.
var own_id;
var send_data_id; // Identifies process sending data to server.
var own_plane;
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth/game_height, 0.1, 1000 );

/* GRAPHICS */

// Adds a rectangle to a player's trail, removing oldest rectangle if necessary.
function add_trail(player, new_coords) {
	var triangleGeometry = new THREE.Geometry();
	triangleGeometry.vertices[0] = player.old_coords.left;
	triangleGeometry.vertices[1] = player.old_coords.right;
	triangleGeometry.vertices[2] = new_coords.left;
	triangleGeometry.vertices[3] = new_coords.right;
	triangleGeometry.faces.push( new THREE.Face3(0, 1, 2) );
	triangleGeometry.faces.push( new THREE.Face3(1, 2, 3) );
	if (player.player_id == own_id) {
		var square = new THREE.Mesh(triangleGeometry, own_material);
	}
	else {
		var square = new THREE.Mesh(triangleGeometry, trail_material);
	}
	player.trail.push(square);
	scene.add(square);
	player.old_coords = new_coords;
}

function shorten_trail( player ) {
	scene.remove(player.trail[0]);
	player.trail.shift();
}

/* CLIENT-SERVER COMMUNICATION */

function send_data() {
	socket.emit("status", {
		id : own_id,
		x_frac : x_frac,
		y_frac : y_frac,
		click : click
	});
}

socket.on("update", function(status) {
	var rot = new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order);
	var player = players.get(status.id);
	player.setRotationFromEuler(rot);
	player.position.set(status.pos.x, status.pos.y, status.pos.z);
	var new_coords = player.getCoords();
	add_trail(player, new_coords);
	shorten_trail(player);
	update_gas(status.gas);
	renderer.render(scene, camera);
	if (player.destroy == true) {
		console.log("DEL.");
		players.delete(status.id);
	}
});

socket.on("id", function(status) {
	own_id = status.id;
	own_player = new Player(status.id, status.pos, status.rot, true);
	for ( var i = 0; i < trail_length; i++ ) {
		own_player.trail.push(own_player.old_coords);
	}
	send_data_id = setInterval(send_data, SEND_INTERVAL);
});

socket.on("add", function(status) {
	var player = new Player(status.id, status.pos, status.rot, false);
	for ( var i = 0; i < trail_length; i++ ) {
		var new_coords = {
			left : new THREE.Vector3( status.trail[i].left.x, status.trail[i].left.y, status.trail[i].left.z ),
			right : new THREE.Vector3( status.trail[i].right.x, status.trail[i].right.y, status.trail[i].right.z )
		};
		add_trail(player, new_coords);
	}
});

socket.on("destroy", function(status) {
	if (status.id in players) {
		for ( square of players.get(status.id).trail ) {
			scene.remove(square);
		}
		players.get(status.id).destroy = true;
	}
	if (status.id == own_id) {
		if (status.reason == "gas") {
			gas = 0;
			update_gas();
		}
		alert("Ouch!");
		clearInterval(send_data_id);
	}
	renderer.render(scene, camera);
});

socket.on("config", function(config) {
	initial_gas = config.initial_gas;
	trail_length = config.trail_length;
	inner_radius = config.inner_radius;
	outer_radius = config.outer_radius;
	draw_sun();
	draw_background();
})

/* CONTROLS */

window.addEventListener('mousemove', function(e) {
	x_frac = (e.clientX - window.innerWidth / 2) / window.innerWidth;
	y_frac = (e.clientY - game_height / 2) / game_height;
});
window.addEventListener('resize', function() {
	game_height = window.innerHeight * frac;
	renderer.setSize( window.innerWidth, game_height );
	camera.aspect = window.innerWidth / game_height;
	gas_bar.style.top = game_height;
	camera.updateProjectionMatrix();
});
window.addEventListener('mousedown', function() {
	click = true;
});
window.addEventListener('mouseup', function() {
	click = false;
});

/* GRAPHICS */

function Player(player_id, pos, rot, add_camera) {
	THREE.Object3D.call(this);
	var geometry = new THREE.BoxGeometry( 1, 1, 20 );
	var material = new THREE.MeshBasicMaterial( { color: 0x0000ff } );
	var cube = new THREE.Mesh( geometry, material );
	var geometry = new THREE.SphereGeometry( 2, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff00ff} );
	var sphere = new THREE.Mesh( geometry, material );
	var geometry = new THREE.BoxGeometry( 10, 1, 1 );
	var material = new THREE.MeshBasicMaterial( { color: 0x0000ff } );
	var cross = new THREE.Mesh( geometry, material );
	var geometry = new THREE.SphereGeometry( 1, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff0000} );
	this.left_guide = new THREE.Mesh( geometry, material );
	this.right_guide = new THREE.Mesh( geometry, material );
	sphere.position.set( 0, 0, 10 );
	cross.position.set( 0, 0, 0 );
	this.left_guide.position.set( 5, 0, 0 );
	this.right_guide.position.set( -5, 0, 0 );
	this.add(cube);
	this.add(sphere);
	this.add(cross);
	this.add(this.left_guide);
	this.add(this.right_guide);
	if (add_camera == true) {
		this.add(camera);
		camera.position.set(0, 0, -25);
		camera.lookAt(0, 0, 0);
	}
	this.position.set(pos.x, pos.y, pos.z);
	this.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	this.updateMatrixWorld();
	scene.add(this);
	this.player_id = player_id;
	this.old_coords = { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
	this.trail = [];
	this.destroy = false;
	players.set(player_id, this);
}

Player.prototype = new THREE.Object3D();
Player.prototype.constructor = Player;
Player.prototype.getCoords = function() {
	return { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	for (var i = 0; i < 100; i++) {
		let radius = Math.random() * 3 + 1;
		let geometry = new THREE.SphereGeometry(radius, 32, 32);
		let r = Math.random() * 1000 + 300;
		let theta = Math.random() * 2 * Math.PI;
		let phi = Math.random() * Math.PI;
		let star = new THREE.Mesh( geometry, material );
		star.position.set(
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		);
		star.position.addScalar(outer_radius);
		scene.add(star);
	}
}

function update_gas(gas) {
	gas_context.clearRect(0, 0, gas_bar.width, gas_bar.height);
	var frac = gas / initial_gas;
	var red = Math.ceil( 255 * (1 - frac) );
	var green = Math.ceil( 255 * frac );
	gas_context.fillStyle = "rgb(" + red + "," + green + "," + "0)";
	gas_context.fillRect(0, 0, gas_bar.width * frac, gas_bar.height);
}

function draw_sun() {
	var material = new THREE.MeshBasicMaterial({
		color: 0xffff11,
		transparent: true,
		opacity: 0.5,
		side: THREE.DoubleSide
	});
	var geometry = new THREE.SphereGeometry(inner_radius, 32, 32);
	var sun = new THREE.Mesh(geometry, material);
	sun.renderOrder = 1;
	sun.position.set(outer_radius, outer_radius, outer_radius);
	scene.add(sun);
}

/* GAS BAR */

gas_bar.style.top = game_height;
gas_bar.width = window.innerWidth;
gas_bar.height = window.innerHeight - game_height;
var gas_context = gas_bar.getContext("2d");
gas_context.fillStyle = "rgb(0, 0, 0)";
gas_context.fillRect(0, 0, gas_bar.width/2, gas_bar.height);
