***Instructions***

To run the game on your local machine, enter the following commands:

```
git clone https://github.com/vungureanu/plane-game.git
cd plane-game
npm install
node js/server.js
```
Then establish a connection on port 3000 using your web browser.  One assumes the role of a pilot whose plane leaves a toxic plume in its wake; the objective of the game is to entangle one's opponents in this plume.  The pitch and yaw of the plane can be controlled using the mouse, while its roll can be controlled using the *a* and *d* keys.  Clicking the mouse causes the plane to travel faster, but consumes gas; traveling at the normal speed replenishes the available gas.  If the plane travels outside of the playing arena, it will reappear at the opposite end. 

***Documentation***

**Overview**

Each player is represented by a Player object, which identifies the player via a unique ID.  This object holds information about the input received from the player and about the player's plane, including its location, rotation, and the shape of its plume.  The shape of a plume is represented by `trail_length` pairs of coordinates; the last pair corresponds to the current location of the plane's wing-tips, the second-to-last pair to their previous location, and so on.  The plume comprises a collection of triangles, each of which represents a stream of plume particles issuing from the plane's wings.  When a new pair of coordinates is added, the oldest pair is removed to simulate the particles' dissipation.

Two consecutive pairs of plume particles define a quadrilateral which can be approximated by a parallelogram.    The playing arena is partitioned into a grid of cubes; planes and plume particles must inform the cube in question when entering or leaving (or dissipating, as the case may be).

**Client-server communication**

To enter the arena, the client sends the server a user-name via a `start` message.  The server then sends a `config` message detailing the current game-play parameters (e.g., the maximum length of a plume), informs the player about each player's score and the locations of all planes presently in the arena, and allocates the player a plane, about which all players are then informed.  Information about a newly-allocated plane is sent to the controlling client via an `id` message and to other clients via `add` messages.  Each player is kept abreast of developments in the arena via `time` messages stating the time remaining in the round and `update` messages specifying the location, orientation, and sequence numbers of other planes.  The client can deduce the shape of each plane's plume from this information, with the sequence number ensuring that out-of-order package receipt do not cause erroneous deductions.  In turn, the client relays player input (e.g., mouse clicks) to the server via `status` messages.  When a plane is destroyed, a `destroy` message is broadcast to all clients.

**Collision-detection mechanism**

The server associates a plane with a collection of edges and its plume with a collection of triangles.  Collision-detection reduces to the problem of determining whether an edge *e* intersects a triangle with vertices *v<sub>i</sub>*.  We choose the sides *s* = *v<sub>2</sub>* - *v<sub>1</sub>* and *t* = *v<sub>3</sub>* - *v<sub>1</sub>* and consider change-of-basis matrix from {*s*, *t*, *s* ⨉ *t*} to the standard basis.  We calculate the point of intersection between the plane in which the triangle lies and *e* and apply the change-of-basis matrix to the coordinates of this point.  If the resulting coordinates lie within the unit triangle, whose vertices are (0, 0, 0), (1, 0, 0), and (0, 1, 0), then *e* does intersect the triangle.
