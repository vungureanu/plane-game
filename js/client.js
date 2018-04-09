var scene = new THREE.Scene();
const game_screen = document.getElementById("game_screen");
const renderer = new THREE.WebGLRenderer( {canvas: game_screen, precision: "lowp"} );
const frac = 19 / 20; // Proportion of screen width taken up by main game
var seconds_left;
var game_height = window.innerHeight * frac;
renderer.setSize(window.innerWidth, game_height);
const gas_bar = document.getElementById("gasBar");
const gas_context = gas_bar.getContext("2d");
const timer = document.getElementById("timer");
const rank = document.getElementById("rank");
const leaders =  document.getElementById("leaders");
var socket = io();
const num_stars = 100;
const moon_texture = new THREE.TextureLoader().load("resources/moon.jpg");
var plane_template;
const slow_rotate = 0.3;
const fast_rotate = 0.6;
const camera_position = new THREE.Vector3(0, -1, 2);

const texture = new THREE.TextureLoader().load("resources/plane_data/BodyTexture.bmp");
const plane_material = new THREE.MeshBasicMaterial( {map: texture} );
var plane_geometry = new THREE.BufferGeometry();
var prop_geometry = new THREE.BufferGeometry();
const objLoader = new THREE.OBJLoader();
objLoader.setPath('resources/plane_data/');
objLoader.load('plane.obj', function(object) {
	geometry_array = object.children.map( (child) => child.geometry );
	plane_geometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometry_array);
});
objLoader.load('prop.obj', function(object) {
	prop_geometry = object.children[0].geometry;
});

const trail_material = new THREE.MeshStandardMaterial({
		color: 0xff0000,
		side : THREE.DoubleSide,
		//transparent : true,
		//opacity: 0.5
});
const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		//transparent : true,
		//opacity: 0.5
});
const bounds_front = {
	color: 0x3065c1,
	transparent: true,
	opacity: 0,
	side: THREE.FrontSide
};
const bounds_back = {
	color: 0x3065c1,
	transparent: true,
	opacity: 0,
	side: THREE.BackSide
};
var trail_length;
const send_interval = 100;
const star_offset = 300;
var num_trail_vertices;
const field_of_view = 75;
var outer_radius;
var inner_radius;
var initial_gas;
var x_frac;
var y_frac;
var roll;
var players = new Map();
var click = false;
var own_id = -1;
var send_data_id;
var render_id;
var own_player = { destroyed: false };
var sides = {};
var camera = new THREE.PerspectiveCamera(field_of_view, window.innerWidth/game_height, 0.1, 1000);
var screen_status = "start";
var buffer = 20;
const vis_dist = 30;
var results = [];
var total_results = -1;
const vertical_spacing = 0.75;
const enter_name = "\n#CONTRAILS\n\n\nEnter nickname: ";
const start_message = "\n\n\nUse the mouse to maneuver; click to accelerate.\nTry to ensnare other players in your trail, but avoid running into other players' trails.\nIf you venture beyond the bounds of the arena, you will reappear on the opposite side.\n\n\nPress ENTER to start.\n";
var user_name = "";
const fade_rate = 20;
const fade_increment = 0.05;
const accepted_characters = /[0-9 + a-z + A-Z + _]/;

/* GRAPHICS */

const main_screen = document.getElementById("main_screen");
main_screen.width = window.innerWidth;
main_screen.height = window.innerHeight;
const screen_context = main_screen.getContext("2d");

function prepare_screen() {
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
	for (var line of lines) {
		if (line.charAt(0) == '#') {
			screen_context.font = Math.floor(vertical_spacing * line_height) * 2 + "px monospace";
			screen_context.fillText(line.substring(1), main_screen.width / 2, offset + line_height * i);
			i += 2;
		}
		else {
			screen_context.font = Math.floor(vertical_spacing * line_height) + "px monospace";
			screen_context.fillText(line, main_screen.width / 2, offset + line_height * i);
			i++;
		}
	}
}

function display_results() {
	prepare_screen();
	if (results.length == 0) { // Perhaps the player joined the game right at the end, and has received only the "results_sent" message 
		format_text(enter_name + user_name + start_message);
		return false;
	}
	var msg = "#LEADERBOARD\n\n\n"
	maximum_length = results.map(el => el.user_name.length).reduce( (prev, cur) => Math.max(prev, cur) );
	for (var result of results) {
		msg += result.user_name + " ".repeat(maximum_length - result.user_name.length + 3) + result.score + "\n";
	}
	msg += "\n\n\nPress ENTER to continue"
	format_text(msg);
	results = [];
	total_results = -1;
}

function draw_polygon(vertex_array, player = false) {
	if (player) {
		var trail_array = player.trail_geometry.attributes.position.array;
		var normal_array = player.trail_geometry.attributes.normal.array;
		var index = player.trail_index;
	}
	else {
		var geometry = new THREE.BufferGeometry();
		geometry.addAttribute( "position", new THREE.BufferAttribute(new Float32Array(18), 3) ); // The quadrilateral is composed of two triangular faces, so we need 6 vertices, each of which has 3 coordinates; whence the 18. 
		geometry.addAttribute( "normal", new THREE.BufferAttribute(new Float32Array(18), 3) );
		geometry.attributes.position.needsUpdate = true;
		geometry.attributes.normal.needsUpdate = true;
		var trail_array = geometry.attributes.position.array;
		var normal_array = geometry.attributes.normal.array;
		var index = 0;
	}
	var normal = new THREE.Vector3().crossVectors( minus(vertex_array[1], vertex_array[0]), minus(vertex_array[3], vertex_array[1]) );
	normal.normalize();
	var faces = [0, 1, 2, 2, 3, 0];
	for (var i = 0; i < faces.length; i++) {
		trail_array[index + 3 * i] = vertex_array[faces[i]].x;
		trail_array[index + 3 * i + 1] = vertex_array[faces[i]].y;
		trail_array[index + 3 * i + 2] = vertex_array[faces[i]].z;
		normal_array[index + 3 * i] = normal.x;
		normal_array[index + 3 * i + 1] = normal.y;
		normal_array[index + 3 * i + 2] = normal.z;
	}
	return geometry;
}

function minus(v1, v2) {
	return new THREE.Vector3(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
}

function add_trail(player, new_coords) {
	player.seq++;
	if (player.old_coords.left.distanceTo(new_coords.left) > outer_radius / 2) {
		player.old_coords = new_coords;
	}
	draw_polygon( [player.old_coords.left, player.old_coords.right, new_coords.right, new_coords.left], player );
	player.trail_index = (player.trail_index + 18) % num_trail_vertices;
	player.old_coords = new_coords;
}

/* CLIENT-SERVER COMMUNICATION */

function send_data() {
	socket.emit("status", {
		id: own_id,
		x_frac: x_frac,
		y_frac: y_frac,
		click: click,
		roll: roll
	});
}

socket.on("update", function(status) {
	if ( (screen_status == "waiting" || screen_status == "game") && players.has(status.id) && !players.get(status.id).destroyed ) {
		var player = players.get(status.id);
		var rot = new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order);
		player.setRotationFromEuler(rot);
		player.position.set(status.pos.x, status.pos.y, status.pos.z);
		if (status.id == own_id) {
			update_bounds();
			update_gas(status.gas);
		}
		player.prop.rotateY(click ? fast_rotate : slow_rotate);
		player.updateMatrixWorld();
		if (player.seq < status.seq) {
			add_trail( player, get_coords(player) );
			player.seq = status.seq;
		}
		requestAnimationFrame(render);
	}
});

socket.on("scores", function(array) {
	for (var el of array) {
		if (players.has(el.player_id)) {
			players.get(el.player_id).score = el.score;
		}
		else {
			players.set(el.player_id, {score: el.score, disconnected: false});
		}
	}
	calculate_rank();
});

socket.on("score", function(player_id) {
	if (players.has(player_id)) {
			players.get(player_id).score++;
	}
	else { // Client has not yet received information about player
		players.set( player_id, {score: 1, disconnected: false} );
	}
	calculate_rank();
});

function calculate_rank() {
	var current_rank = 1;
	for ( player of players.values() ) {
		current_rank += (player.score > own_player.score) ? 1 : 0;
	}
	rank.innerHTML = "Rank: " + current_rank + '/' + players.size;
}

function render() {
	for ( var player of players.values() ) {
		player.trail_geometry.attributes.position.needsUpdate = true;
		player.trail_geometry.attributes.normal.needsUpdate = true;
	}
	renderer.render(scene, camera);
}

socket.on("id", function(status) {
	if (own_id != -1) {
		own_player.remove(camera);
	}
	own_id = status.id;
	roll = "None";
	x_frac = 0;
	y_frac = 0;
	own_player = create_player(status.id, status.pos, status.rot, true, status.user_name);
	if (screen_status == "waiting") {
		screen_status = "game";
		set_visibility("game");
	}
	calculate_rank();
	requestAnimationFrame(render);
	send_data_id = setInterval(send_data, send_interval);
});

socket.on("add", function(status) {
	var player = create_player(status.id, status.pos, status.rot, false, status.user_name);
	if (player) { // Do not proceed if the player has already been destroyed
		create_trail(player, status.trail);
		calculate_rank();
	}
});

function create_trail(player, trail) {
	for ( var i = 0; i < trail.length; i++ ) {
		var new_coords = {
			left : new THREE.Vector3(trail[i].left.x, trail[i].left.y, trail[i].left.z),
			right : new THREE.Vector3(trail[i].right.x, trail[i].right.y, trail[i].right.z )
		};
		add_trail(player, new_coords);
	}
}

socket.on("destroy", function(status) {
	if ( players.has(status.id) ) {
		if (status.reason == "disconnection") {
			scene.remove( players.get(status.id) );
			scene.remove( players.get(status.id).trail_mesh );
			players.delete(status.id);
			calculate_rank();
		}
		else {
			explode( players.get(status.id) );
		}
	}
	else {
		players.set( status.id, {score: 0, disconnected: true} );
		// Player disconnected before connect message received
	}
	if (status.id == own_id) {
		clearInterval(send_data_id);
		own_id = -1;
	}
});

socket.on("game_over", function() {
	clearInterval(send_data_id);
	screen_status = "end";
	set_visibility("text");
});

socket.on("config", function(config) {
	initial_gas = config.initial_gas;
	trail_length = config.trail_length;
	inner_radius = config.inner_radius;
	outer_radius = config.outer_radius;
	seconds_left = config.seconds_left;
	num_trail_vertices = (trail_length - 1) * 18;
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
		results.sort( (a, b) => a.score > b.score ? -1 : 1 );
		display_results();
	}
});

socket.on("results_sent", function(length) {
	total_results = length;
	if (results.length == total_results) {
		results.sort( (a, b) => a.score > b.score ? -1 : 1 );
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

	requestAnimationFrame(render);
});

window.addEventListener("mousedown", function() {
	click = true;
});

window.addEventListener("keydown", function(e) {
	if (screen_status != "game" ) {
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
	}
	else {
		if (e.key == "a" || e.key == "A") {
			roll = "CCW";
		}
		else if (e.key == "d" || e.key == "D") {
			roll = "CW";
		}
		else if (e.key == " ") {
			draw_leaders();
		}
	}
});
window.addEventListener("keyup", function(e) {
	if (e.key == "a" || e.key == "A") {
		roll = (roll == "CCW" ? "None" : "CW");
	}
	else if (e.key == "d" || e.key == "D") {
		roll = (roll == "CW" ? "None" : "CCW");
	}
});

window.addEventListener("mouseup", function() {
	click = false;
});

/* GRAPHICS */

function create_player(player_id, pos, rot, add_camera, user_name) {
	if (players.has(player_id) && players.get(player_id).disconnected) {
		return false;
	}
	var material = plane_material.clone();
	var player = new THREE.Mesh(plane_geometry, material);
	player.prop = new THREE.Mesh(prop_geometry, material);
	player.prop.position.set(0, 5.7, 0.8);
	player.add(player.prop);
	player.left_guide = new THREE.Object3D();
	player.right_guide = new THREE.Object3D();
	player.left_guide.position.set(-7, 2, 0);
	player.right_guide.position.set(7, 2, 0);
	player.add(player.left_guide);
	player.add(player.right_guide);
	if (add_camera) {
		player.add(camera);
		camera.position.set(camera_position.x, camera_position.y, camera_position.z);
		camera.lookAt(camera_position.x, camera_position.y + 1, camera_position.z);
		player.light = new THREE.PointLight(0xffffff, 2, 200);
		player.add(player.light);
		player.light.position.set(0, 0, 0);
	}
	player.position.set(pos.x, pos.y, pos.z);
	player.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	player.updateMatrixWorld();
	scene.add(player);
	player.player_id = player_id;
	player.old_coords = { left: player.left_guide.getWorldPosition(), right: player.right_guide.getWorldPosition() };
	player.trail_index = 0;
	player.trail_geometry = new THREE.BufferGeometry();
	player.trail_mesh = new THREE.Mesh(player.trail_geometry, (own_id == player_id) ? own_material : trail_material);
	player.trail_mesh.frustumCulled = false;
	scene.add(player.trail_mesh);
	var trail_vertices = new Float32Array(num_trail_vertices);
	var position_buffer = new THREE.BufferAttribute(trail_vertices, 3);
	player.trail_geometry.addAttribute("position", position_buffer);
	var trail_normals = new Float32Array(num_trail_vertices);
	var normal_buffer = new THREE.BufferAttribute(trail_normals, 3);
	player.trail_geometry.addAttribute("normal", normal_buffer);
	player.fade_id = -1;
	player.destroyed = false;
	player.user_name = user_name;
	player.seq = 0;
	player.score = players.has(player_id) ? players.get(player_id).score : 0;
	players.set(player_id, player);
	return player;
}

function get_coords(player) {
	return { left: player.left_guide.getWorldPosition(), right: player.right_guide.getWorldPosition() };
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	var merged_geometry = new THREE.Geometry();
	var geometries = [];
	for (var i = 0; i < 3; i++) {
		geometries.push( new THREE.SphereGeometry(1 + i / 3, 3, 2) );
	}
	for (var i = 0; i < num_stars; i++) {
		let r = Math.random() * outer_radius + outer_radius + star_offset;
		let theta = Math.random() * 2 * Math.PI;
		let phi = Math.random() * Math.PI;
		let star = new THREE.Object3D();
		star.position.set(
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		);
		star.position.addScalar(outer_radius);
		star.updateMatrix();
		merged_geometry.merge(geometries[i % 3], star.matrix);
	}
	var stars = new THREE.Mesh(merged_geometry, material);
	scene.add(stars);
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
	var material = new THREE.MeshLambertMaterial( {map: moon_texture} );
	var geometry = new THREE.SphereGeometry(inner_radius, 32, 32);
	var moon = new THREE.Mesh(geometry, material);
	moon.position.set(outer_radius, outer_radius, outer_radius);
	scene.add(moon);
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
	timer.innerHTML = "Time remaining: " + Math.floor(seconds_left / 60) + ":" + (seconds_left % 60 < 10 ? "0" : "") + (seconds_left % 60);
}

/* MISC */

function explode(player) {
	player.destroyed = true;
	scene.remove(player.trail_mesh);
	player.material.transparent = true;
	player.fade_id = setInterval(fade_away, fade_rate, player);
}

function fade_away(player) {
	if (player.material.opacity <= 0) {
		clearInterval(player.fade_id);
		scene.remove(player);
		scene.remove(player.trail_mesh);
		requestAnimationFrame(render);
	}
	else {
		player.material.opacity -= fade_increment;
		requestAnimationFrame(render);
	}
}

function draw_leaders() {
	if (leaders.innerHTML != "") {
		leaders.innerHTML = "";
		return;
	}
	player_info = [];
	for ( var player of players.values() ) {
		if (!player.disconnected) {
			player_info.push( { user_name: player.user_name, player_id: player.player_id, score: player.score} );
		}
	}
	player_info.sort( (a, b) => (a.score > b.score) ? -1 : 1 );
	for (var player of player_info) {
		if (player.player_id == own_id) {
			leaders.innerHTML += "<span style=\"font-weight: bold\">" + player.user_name + ": " + player.score + "</span><br>"
		}
		else {
			leaders.innerHTML += player.user_name + ": " + player.score + "<br>"
		}
	}
}

function set_visibility(type) {
	if (type == "game") {
		main_screen.style.visibility = "hidden";
		game_screen.style.visibility = "visible";
		gas_bar.style.visibility = "visible";
		timer.style.visibility = "visible";
		rank.style.visibility = "visible";
	}
	else if (type == "text") {
		main_screen.style.visibility = "visible";
		game_screen.style.visibility = "hidden";
		gas_bar.style.visibility = "hidden";
		timer.style.visibility = "hidden";
		rank.style.visibility = "hidden";
	}
}
set_visibility("text");