var scene;
const game_screen = document.getElementById("game_screen");
const renderer = new THREE.WebGLRenderer( {canvas: game_screen} );
const frac = 19 / 20; // Proportion of screen width taken up by main game
var seconds_left;
var game_height = window.innerHeight * frac;
renderer.setSize(window.innerWidth, game_height);
const gas_bar = document.getElementById("gasBar");
const gas_context = gas_bar.getContext("2d");
const timer = document.getElementById("timer");
game_screen.style.visibility = "hidden";
gas_bar.style.visibility = "hidden";
timer.style.visibility = "hidden";
var socket = io();
const num_stars = 100;
const moon_texture = new THREE.TextureLoader().load("textures/moon.jpg");
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
const bounds_front = {
	color: 0xaa2727,
	transparent: true,
	opacity: 0,
	side: THREE.FrontSide
};
const bounds_back = {
	color: 0xaa2727,
	transparent: true,
	opacity: 0,
	side: THREE.BackSide
};
var trail_length;
const send_interval = 100; // Milliseconds between successive send operations
const star_offset = 300;
const field_of_view = 75;
var outer_radius;
var inner_radius;
var initial_gas;
// Distance of mouse away from center, as fraction of the canvas's width or height
var x_frac;
var y_frac;
var players = new Map(); // State (spatial coordinates and orientation) of all other players
var click = false; // Whether mouse is depressed.
var own_id = -1;
var send_data_id; // Identifies process sending data to server.
var own_player;
var sides = {}; // Outer boundaries of space
var camera;
var screen_status = "start";
var buffer = 20;
const vis_dist = 30;
var results = [];
var total_results;
const vertical_spacing = 0.75;
const enter_name = "\n#CONTRAILS\n\n\nEnter nickname: ";
const start_message = "\n\n\nUse the mouse to maneuver; click to accelerate.\nTry to ensnare other players in your trail, but avoid running into other players' trails.\nIf you venture beyond the bounds of the arena, you will reappear on the opposite side.\n\n\nPress ENTER to start.\n";
var user_name = "";
const fade_rate = 20;
const fade_increment = 0.1;
const accepted_characters = /[0-9 + a-z + A-Z + _]/;

/* GRAPHICS */

const main_screen = document.getElementById("main_screen");
main_screen.width = window.innerWidth;
main_screen.height = window.innerHeight;
main_screen.style.visibility = "visible";
const screen_context = main_screen.getContext("2d");

function prepare_screen() {
	main_screen.style.visibility = "visible";
	main_screen.height = window.innerHeight;
	main_screen.width = window.innerWidth;
	screen_context.clearRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(0, 0, 0)";
	screen_context.fillRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(255, 255, 255)";
}

prepare_screen();
format_text(enter_name + user_name + start_message);

function format_text(msg) {
	prepare_screen();
	var lines = msg.split('\n');
	var length = lines.length + lines.reduce( (acc, cur) => acc + cur.charAt(0) == '#' ? 1 : 0, 0);
	var line_height = Math.min(main_screen.height / length, 32);
	var total_height = line_height * length;
	var offset = (main_screen.height - total_height) / 2; 
	screen_context.textBaseline = "middle";
	screen_context.textAlign = "center";
	screen_context.fillStyle = "rgb(255, 255, 255)";
	var i = 0;
	for (line of lines) {
		if (line.charAt(0) == '#') {
			screen_context.font = Math.floor(vertical_spacing * line_height) * 2 + "px serif";
			screen_context.fillText(line.substring(1), main_screen.width / 2, offset + line_height * i);
			i += 2;
		}
		else {
			screen_context.font = Math.floor(vertical_spacing * line_height) + "px serif";
			screen_context.fillText(line, main_screen.width / 2, offset + line_height * i);
			i++;
		}
	}
}

function display_results() {
	prepare_screen();
	var msg = "#LEADERBOARD\n\n\n"
	for (var result of results) {
		msg += result.user_name + ": " + result.score + "\n";
	}
	msg += "\n\n\nPress ENTER to continue"
	format_text(msg);
}

function draw_polygon(vertex_array) {
	var geometry = new THREE.Geometry();
	for (var i = 0; i < vertex_array.length; i++) {
		geometry.vertices[i] = vertex_array[i];
	}
	for (var i = 0; i < vertex_array.length - 1; i++) {
		geometry.faces.push( new THREE.Face3(0, i, i+1) );
	}
	return geometry;
}

function add_trail(player, new_coords) {
	if (player.old_coords.left.distanceTo(new_coords.left) > outer_radius / 2) {
		player.old_coords = new_coords;
	}
	var geometry = draw_polygon( [player.old_coords.left, player.old_coords.right, new_coords.right, new_coords.left] );
	var square = player.player_id == own_id ? new THREE.Mesh(geometry, own_material) : new THREE.Mesh(geometry, trail_material);
	player.trail.push(square);
	scene.add(square);
	player.old_coords = new_coords;
}

function shorten_trail(player) {
	scene.remove(player.trail[0]);
	player.trail.shift();
}

/* CLIENT-SERVER COMMUNICATION */

function send_data() {
	socket.emit("status", {
		id: own_id,
		x_frac: x_frac,
		y_frac: y_frac,
		click: click
	});
}

socket.on("update", function(status) {
	if ( (screen_status == "waiting" || screen_status == "game") && players.has(status.id) ) {
		var player = players.get(status.id);
		var rot = new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order);
		player.setRotationFromEuler(rot);
		player.position.set(status.pos.x, status.pos.y, status.pos.z);
		if (status.id == own_id) {
			update_bounds();
			update_gas(status.gas);
		}
		var new_coords = player.getCoords();
		add_trail(player, new_coords);
		shorten_trail(player);
		renderer.render(scene, camera);
	}
});

socket.on("id", function(status) {
	if (own_id != -1) {
		own_player.remove(camera);
	}
	own_id = status.id;
	own_player = new Player(status.id, status.pos, status.rot, true);
	renderer.render(scene, camera);
	if (screen_status == "waiting") {
		screen_status = "game";
		main_screen.style.visibility = "hidden";
		game_screen.style.visibility = "visible";
		gas_bar.style.visibility = "visible";
		timer.style.visibility = "visible";
		results = [];
		total_results = -1;
	}
	for (var i = 0; i < trail_length; i++) {
		own_player.trail.push(own_player.old_coords);
	}
	send_data_id = setInterval(send_data, send_interval);
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
	if ( players.has(status.id) ) {
		explode( players.get(status.id) );
	}
	if (status.id == own_id) {
		clearInterval(send_data_id);
		own_id = -1;
	}
	renderer.render(scene, camera);
});

socket.on("game_over", function() {
	clearInterval(send_data_id);
	screen_status = "end";
	game_screen.style.visibility = "hidden";
	gas_bar.style.visibility = "hidden";
	timer.style.visibility = "hidden";
});

socket.on("config", function(config) {
	initial_gas = config.initial_gas;
	trail_length = config.trail_length;
	inner_radius = config.inner_radius;
	outer_radius = config.outer_radius;
	seconds_left = config.seconds_left;
	players = new Map();
	camera = new THREE.PerspectiveCamera(field_of_view, window.innerWidth/game_height, 0.1, 1000);
	scene = new THREE.Scene();
	draw_moon();
	draw_background();
	draw_bounds();
	update_gas();
	draw_time();
});

socket.on("time", function(sl) {
	seconds_left = sl;
	draw_time();
});

socket.on("result", function(status) {
	results.push( {user_name: status.user_name, score: status.score} );
	if (results.length == total_results) {
		results.sort( (a, b) => a.score < b.score ? -1 : 1 );
		display_results();
	}
});

socket.on("results_sent", function(length) {
	total_results = length;
	if (results.length == total_results) {
		results.sort( (a, b) => a.score < b.score ? -1 : 1 );
		display_results();
	}
});

/* CONTROLS */

window.addEventListener("mousemove", function(e) {
	x_frac = (e.clientX - window.innerWidth / 2) / window.innerWidth;
	y_frac = (e.clientY - game_height / 2) / game_height;
});

window.addEventListener("resize", function() {
	game_height = window.innerHeight * frac;
	renderer.setSize(window.innerWidth, game_height);
	camera.aspect = window.innerWidth / game_height;
	camera.updateProjectionMatrix();
	update_gas();
	if (screen_status == "start") {
		format_text(enter_name + user_name + start_message);
	}
	if (screen_status == "end") {
		display_results();
	}
});

window.addEventListener("mousedown", function() {
	click = true;
});

window.addEventListener("keydown", function(e) {
	if (e.key == "Enter") {
		if (screen_status == "end") {
			screen_status = "start";
			format_text(enter_name + user_name + start_message);
		}
		else if (screen_status == "start") {
			screen_status = "waiting";
			socket.emit("start", user_name);
		}
	}
	else if ( e.key.length == 1 && e.key.match(accepted_characters) ) {
		user_name += e.key;
		format_text(enter_name + user_name + start_message);
	}
	else if (e.key == "Backspace") {
		user_name = user_name.slice(0, -1);
		format_text(enter_name + user_name + start_message);
	}
});

window.addEventListener("mouseup", function() {
	click = false;
});

/* GRAPHICS */

function Player(player_id, pos, rot, add_camera) {
	THREE.Object3D.call(this);
	this.materials = [
		new THREE.MeshBasicMaterial( {color: 0x0000ff, side: THREE.DoubleSide} ),
		new THREE.MeshBasicMaterial( {color: 0xff00ff, side: THREE.DoubleSide} ),
		new THREE.MeshBasicMaterial( {color: 0x0000ff, side: THREE.DoubleSide} ),
		new THREE.MeshBasicMaterial( {color: 0xff0000, side: THREE.DoubleSide} )
	];
	var top = [
		new THREE.Vector3(0, 15, 1),
		new THREE.Vector3(-10, 0, 1),
		new THREE.Vector3(0, 5, 1),
		new THREE.Vector3(10, 0, 1)
	];
	var bot = top.map( (v) => new THREE.Vector3(v.x, v.y, -v.z) );
	var top_shape = new THREE.Mesh( draw_polygon( [top[0], top[1], top[2], top[3]] ), this.materials[0] );
	var bot_shape = new THREE.Mesh( draw_polygon( [bot[0], bot[1], bot[2], bot[3]] ), this.materials[0] );
	for (var i = 0; i < 4; i++) {
		let j = (i + 1) % 4;
		let shape = new THREE.Mesh( draw_polygon( [top[i], top[j], bot[j], bot[i]] ), this.materials[1] );
		this.add(shape);
	}
	this.left_guide = new THREE.Object3D();
	this.right_guide = new THREE.Object3D();
	this.left_guide.position.set(-10, 0, 0);
	this.right_guide.position.set(10, 0, 0);
	this.add(this.left_guide);
	this.add(this.right_guide);
	this.add(top_shape);
	this.add(bot_shape);
	if (add_camera == true) {
		this.add(camera);
		camera.position.set(0, -25, 5);
		camera.lookAt(0, 10, 1);
	}
	this.position.set(pos.x, pos.y, pos.z);
	this.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	this.updateMatrixWorld();
	scene.add(this);
	this.player_id = player_id;
	this.old_coords = { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
	this.trail = [];
	this.destroy = false;
	this.fade_id = -1;
	players.set(player_id, this);
}

Player.prototype = new THREE.Object3D();
Player.prototype.constructor = Player;
Player.prototype.getCoords = function() {
	return { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	for (var i = 0; i < num_stars; i++) {
		let radius = Math.random() * 1 + 0.5;
		let geometry = new THREE.SphereGeometry(radius, 32, 32);
		let r = Math.random() * outer_radius + outer_radius + star_offset;
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
	gas_bar.width = window.innerWidth;
	gas_bar.height = window.innerHeight - game_height;
	gas_bar.style.top = game_height;
	gas_context.clearRect(0, 0, gas_bar.width, gas_bar.height);
	gas_context.fillStyle = "rgb(0, 0, 0)";
	gas_context.fillRect(0, 0, gas_bar.width, gas_bar.height);
	var frac = gas / initial_gas;
	var red = Math.ceil( 255 * (1 - frac) );
	var green = Math.ceil(255 * frac);
	gas_context.fillStyle = "rgb(" + red + "," + green + "," + "0)";
	gas_context.fillRect(0, 0, gas_bar.width * frac, gas_bar.height);
}

function draw_moon() {
	var material = new THREE.MeshBasicMaterial( {map: moon_texture} );
	var geometry = new THREE.SphereGeometry(inner_radius, 32, 32);
	var sun = new THREE.Mesh(geometry, material);
	sun.renderOrder = 0;
	sun.position.set(outer_radius, outer_radius, outer_radius);
	scene.add(sun);
}

function draw_bounds() {
	var l = 2 * outer_radius;
	var p0 = new THREE.Vector3(0, 0, 0);
	var p1 = new THREE.Vector3(0, 0, l);
	var p2 = new THREE.Vector3(0, l, l);
	var p3 = new THREE.Vector3(0, l, 0);
	var p4 = new THREE.Vector3(l, 0, 0);
	var p5 = new THREE.Vector3(l, 0, l);
	var p6 = new THREE.Vector3(l, l, l);
	var p7 = new THREE.Vector3(l, l, 0);
	var geometry0 = draw_polygon( [p0, p1, p2, p3] );
	sides.x0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry0, sides.x0) );
	var geometry1 = draw_polygon( [p4, p5, p6, p7] );
	sides.x1 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry1, sides.x1) );
	var geometry2 = draw_polygon( [p0, p1, p5, p4] );
	sides.y0 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry2, sides.y0) );
	var geometry3 = draw_polygon( [p3, p2, p6, p7] );
	sides.y1 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry3, sides.y1) );
	var geometry4 = draw_polygon( [p0, p3, p7, p4] ); 
	sides.z0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry4, sides.z0) );
	var geometry5 = draw_polygon( [p1, p2, p6, p5] );
	sides.z1 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry5, sides.z1) );
}

function update_bounds() {
	var coords = own_player.getWorldPosition();
	for ( var dim of ["x", "y", "z"] ) {
		sides[dim + 0].opacity = coords[dim] < vis_dist + buffer ? 1 - (coords[dim] - buffer) / vis_dist : 0;
		sides[dim + 1].opacity = coords[dim] > 2 * outer_radius - buffer - vis_dist ? 1 - (2 * outer_radius - buffer - coords[dim]) / vis_dist : 0;
	}
}

function draw_time() {
	timer.innerHTML = "Time remaining: " + Math.floor(seconds_left / 60) + ":" + (seconds_left < 10 ? "0" : "") + (seconds_left % 60);
}

/* MISC */

function remove_player(player) {
	for (square of player.trail) {
		scene.remove(square);
	}
	if (player.player_id == own_id) {
		player.remove(camera);
	}
	scene.remove(player);
}

function explode(player) {
	for (square of player.trail) {
		scene.remove(square);
	}
	for (material of player.materials) {
		material.transparent = true;
	}
	player.fade_id = setInterval(fade_away, fade_rate, player);
}

function fade_away(player) {
	if (player.materials[0].opacity <= 0) {
		clearInterval(player.fade_id);
		scene.remove(player);
	}
	for (material of player.materials) {
		material.opacity -= fade_increment;
	}
	renderer.render(scene, camera);
}