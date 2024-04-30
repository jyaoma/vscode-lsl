import { LSLType } from './lslTypes';

export const convertToType = (type: string): LSLType => {
	switch (type) {
		case 'integer':
			return LSLType.Integer;
		case 'float':
			return LSLType.Float;
		case 'string':
			return LSLType.String;
		case 'key':
			return LSLType.Key;
		case 'vector':
			return LSLType.Vector;
		case 'rotation':
			return LSLType.Rotation;
		case 'quarternion':
			return LSLType.Rotation;
		case 'list':
			return LSLType.List;
		default:
			return LSLType.Unknown;
	}
};
