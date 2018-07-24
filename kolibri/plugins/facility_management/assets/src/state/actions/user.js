import pickBy from 'lodash/pickBy';
import { FacilityUserResource } from 'kolibri.resources';
import samePageCheckGenerator from 'kolibri.utils.samePageCheckGenerator';
import { UserKinds } from 'kolibri.coreVue.vuex.constants';
import { PageNames } from '../../constants';
import { _userState } from './helpers/mappers';
import preparePage from './helpers/preparePage';
import displayModal from './helpers/displayModal';
import { updateFacilityLevelRoles } from './rolesActions';

/**
 * Does a POST request to assign a user role (only used in this file)
 * @param {Object} user
 * @param {string} user.id
 * @param {string} user.facility
 * @param {string} user.roles
 * Needed: id, facility, role
 */
function setUserRole(user, role) {
  return updateFacilityLevelRoles(user, role.kind).then(() => {
    // Force refresh the User to get updated roles
    return FacilityUserResource.fetchModel({ id: user.id, force: true });
  });
}

/**
 * Do a POST to create new user
 * @param {object} stateUserData
 *  Needed: username, full_name, facility, role, password
 */
export function createUser(store, stateUserData) {
  // resolves with user object
  return FacilityUserResource.saveModel({
    data: {
      facility: store.state.core.session.facility_id,
      username: stateUserData.username,
      full_name: stateUserData.full_name,
      password: stateUserData.password,
    },
  })
    .then(userModel => {
      function dispatchUser(newUser) {
        const userState = _userState(newUser);
        store.commit('ADD_USER', userState);
        // TODO to be removed
        store.commit('SET_USER_JUST_CREATED', userState);
        displayModal(store, false);
        return userState;
      }
      // only runs if there's a role to be assigned
      if (stateUserData.role.kind !== UserKinds.LEARNER) {
        return setUserRole(userModel, stateUserData.role).then(user => dispatchUser(user));
      } else {
        // no role to assigned
        return dispatchUser(userModel);
      }
    })
    .catch(error => store.dispatch('handleApiError', error));
}

/**
 * Do a PATCH to update existing user
 * @param {object} store
 * @param {string} userId
 * @param {object} updates Optional Changes: full_name, username, password, and kind(role)
 */
export function updateUser(store, { userId, updates }) {
  store.commit('SET_ERROR', '');
  store.commit('SET_BUSY', true);
  const origUserState = store.state.pageState.facilityUsers.find(user => user.id === userId);
  const facilityRoleHasChanged = origUserState.kind !== updates.role.kind;

  return updateFacilityUser(store, { userId, updates }).then(
    updatedUser => {
      const update = userData => store.commit('UPDATE_USER', _userState(userData));
      if (facilityRoleHasChanged) {
        if (store.getters.currentUserId === userId && store.getters.isSuperuser) {
          // maintain superuser if updating self.
          store.commit('UPDATE_CURRENT_USER_KIND', [UserKinds.SUPERUSER, updates.role.kind]);
        }
        return setUserRole(updatedUser, updates.role).then(userWithRole => {
          update(userWithRole);
        });
      } else {
        update(updatedUser);
      }
    },
    error => {
      if (error.status.code === 400) {
        store.commit('SET_ERROR', Object.values(error.entity)[0][0]);
      } else if (error.status.code === 403) {
        store.commit('SET_ERROR', error.entity);
      }
      store.commit('SET_BUSY', false);
    }
  );
}

// Update fields on the FacilityUser model
// updates :: { full_name, username, password }
export function updateFacilityUser(store, { userId, updates }) {
  const origUserState = store.state.pageState.facilityUsers.find(user => user.id === userId);
  const changedValues = pickBy(
    updates,
    (value, key) => updates[key] && updates[key] !== origUserState[key]
  );
  const facilityUserHasChanged = Object.keys(changedValues).length > 0;

  if (facilityUserHasChanged) {
    return FacilityUserResource.saveModel({ id: userId, data: changedValues });
  }
  return Promise.resolve({
    ...origUserState,
    facility: origUserState.facility_id,
  });
}

/**
 * Do a DELETE to delete the user.
 * @param {string or Integer} id
 */
export function deleteUser(store, id) {
  if (!id) {
    // if no id passed, abort the function
    return;
  }
  FacilityUserResource.deleteModel({ id }).then(
    () => {
      store.commit('DELETE_USER', id);
      displayModal(store, false);
      if (store.state.core.session.user_id === id) {
        store.dispatch('kolibriLogout');
      }
    },
    error => {
      store.dispatch('handleApiError', error);
    }
  );
}

// An action for setting up the initial state of the app by fetching data from the server
export function showUserPage(store) {
  preparePage(store.commit, {
    name: PageNames.USER_MGMT_PAGE,
  });

  const facilityId = store.getters.currentFacilityId;

  FacilityUserResource.fetchCollection({
    getParams: { member_of: facilityId },
    force: true,
  }).only(
    samePageCheckGenerator(store),
    users => {
      store.commit('SET_PAGE_STATE', {
        facilityUsers: users.map(_userState),
        modalShown: false,
        error: '',
        isBusy: false,
      });
      store.commit('CORE_SET_PAGE_LOADING', false);
    },
    error => {
      store.dispatch('handleApiError', error);
    }
  );
}
