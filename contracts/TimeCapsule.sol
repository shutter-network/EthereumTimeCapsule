// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract TimeCapsule {
    struct Capsule {
        address creator;
        string title;
        string tags;
        bytes encryptedStory;    // Shutter-encrypted story ciphertext
        string decryptedStory;   // Plaintext story (after reveal)
        bool isRevealed;
        uint256 revealTime;      // Timestamp after which reveal is allowed
        string shutterIdentity;  // Shutter identity used for encryption
        string imageCID;         // IPFS CID of the encrypted image
        string pixelatedImageCID; // IPFS CID of the pixelated preview image
    }

    struct CapsuleData {
        string title;
        string tags;
        bytes encryptedStory;
        uint256 revealTime;
        string shutterIdentity;
        string imageCID;
        string pixelatedImageCID;
    }

    mapping(uint256 => Capsule) public capsules;
    uint256 public capsuleCount;

    event CapsuleCreated(
        uint256 indexed id,
        address indexed creator,
        string title,
        string tags,
        uint256 revealTime,
        string shutterIdentity,
        string imageCID,
        string pixelatedImageCID
    );
    event CapsuleRevealed(
        uint256 indexed id,
        address indexed revealer,
        string plaintextStory
    );

    /**
     * @dev Commit a new time capsule with encrypted content.
     * @param data Struct containing all capsule data (title, tags, encryptedStory, revealTime, shutterIdentity, imageCID, pixelatedImageCID).
     */
    function commitCapsule(CapsuleData calldata data)
        external
    {
        require(data.revealTime > block.timestamp, "Reveal time must be in the future");
        // (Optional) enforce roughly one-year lockup:
        // require(data.revealTime >= block.timestamp + 365 days, "Reveal time must be ~1 year out");

        // Store the capsule data on-chain
        capsules[capsuleCount] = Capsule({
            creator: msg.sender,
            title: data.title,
            tags: data.tags,
            encryptedStory: data.encryptedStory,
            decryptedStory: "",
            isRevealed: false,
            revealTime: data.revealTime,
            shutterIdentity: data.shutterIdentity,
            imageCID: data.imageCID,
            pixelatedImageCID: data.pixelatedImageCID
        });
        emit CapsuleCreated(capsuleCount, msg.sender, data.title, data.tags, data.revealTime, data.shutterIdentity, data.imageCID, data.pixelatedImageCID);
        capsuleCount++;
    }

    /**
     * @dev Reveal the capsule's story after the Shutter network has released the decryption key.
     * @param _id The capsule ID to reveal.
     * @param _plaintext The decrypted story text.
     */
    function revealCapsule(uint256 _id, string calldata _plaintext) external {
        Capsule storage c = capsules[_id];
        require(!c.isRevealed, "Capsule already revealed");
        require(block.timestamp >= c.revealTime, "Too early to reveal");  // Ensure one-year time lock elapsed

        c.decryptedStory = _plaintext;
        c.isRevealed = true;
        emit CapsuleRevealed(_id, msg.sender, _plaintext);
    }

    // (Optional) a helper to retrieve capsule data in one go
    function getCapsule(uint256 _id) external view returns (Capsule memory) {
        return capsules[_id];
    }
}
